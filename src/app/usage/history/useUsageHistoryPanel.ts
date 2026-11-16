import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../../shared/usage-history-contract'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import { RANGE_MS, hasDrawableSuccess } from '@domain/usage/history/chart-time-domain'
import { historyEligibility } from '@domain/usage/history/eligibility'
import type { HistoryEligibility } from '@domain/usage/history/eligibility'
import type { KeyValueStorage } from '@domain/usage/history/ports'
import { bucketRecordFromPage, withLabels } from '@domain/usage/history/record'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { t } from '@shared/messages'
import { usageQueryOptions, UsageLoadError } from '../usage-query'
import { providerMetaFor } from '../provider-meta'
import { useUsage } from '../useUsage'
import { useUsageDeps } from '../UsageGatewayContext'
import type { ChartButtonState, ChartPanelActions, ChartPanelState, ChartView, UsageHistoryPanelBinding } from './chart-view'
import { DEFAULT_CHART_SIZE } from './chart-view-input'
import { prefsOf } from './chart-prefs-store'
import { resolveViewBuilder, useHistoryDeps } from './HistoryDepsContext'
import { HISTORY_DATA_GC_MS, historyBucketsQueryOptions, historyDataKey, historyWarmKey, historyDataQueryOptions, historySummaryQueryOptions, historySyncKey, runDedupedSync, throwForOutcome } from './history-query'

/** 이 탭에서 열어 둔 패널(sessionStorage). 같은 탭의 새로고침·재로그인 복귀에서만 복원된다. */
export const CHART_OPEN_KEY = 'zzik:chart-open:v1'
const NONE: readonly string[] = []

export function readOpenPanels(storage: KeyValueStorage): UsageProvider[] {
  try {
    const value: unknown = JSON.parse(storage.get(CHART_OPEN_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 1) return []
    const open = (value as { open?: unknown }).open
    if (!Array.isArray(open)) return []
    // 알려진 제공자만, 중복 없이, 최대 6개(제공자 수)
    const known = new Set<UsageProvider>()
    for (const item of open) if (typeof item === 'string' && (USAGE_PROVIDERS as readonly string[]).includes(item)) known.add(item as UsageProvider)
    return [...known].slice(0, USAGE_PROVIDERS.length)
  } catch {
    return []
  }
}

export function writeOpenPanels(storage: KeyValueStorage, open: readonly UsageProvider[]): void {
  if (open.length === 0) storage.remove(CHART_OPEN_KEY)
  else storage.set(CHART_OPEN_KEY, JSON.stringify({ v: 1, open }))
}

/** 요약을 못 받았을 때 이 브라우저의 레코드에 든 ok 표본으로 같은 기준을 계산한다(10절). */
export function summaryEntryFromRecord(record: HistoryCacheRecord): UsageHistorySummaryEntry {
  const oks = [...(record.anchor?.status === 'ok' ? [record.anchor] : []), ...record.samples.filter((sample) => sample.status === 'ok')]
  return { provider: record.provider, okCount: Math.min(oks.length, USAGE_HISTORY_MIN_OK_EVENTS), firstOkAt: oks[0]?.fetchedAt ?? oks[0]?.runAt ?? null, lastOkAt: oks.at(-1)?.fetchedAt ?? oks.at(-1)?.runAt ?? null }
}

function hintFor(eligibility: HistoryEligibility): string | null {
  if (eligibility.eligible) return null
  if (eligibility.reason === 'no_data') return t('chart.hint.noData')
  if (eligibility.reason === 'too_few') return t('chart.hint.tooFew', { min: USAGE_HISTORY_MIN_OK_EVENTS, n: eligibility.okCount })
  return t('chart.hint.tooShort', { hours: Math.max(1, Math.ceil((eligibility.remainingMs ?? 0) / 3_600_000)) })
}

export function useUsageHistoryPanel(provider: UsageProvider): UsageHistoryPanelBinding {
  const deps = useHistoryDeps()
  const usageDeps = useUsageDeps()
  const client = useQueryClient()
  const meta = providerMetaFor(provider)
  const panelId = `usage-history-${provider}`

  const [open, setOpen] = useState(() => deps.enabled && readOpenPanels(deps.session).includes(provider))
  const [size, setSize] = useState<{ width: number; height: number }>({ ...DEFAULT_CHART_SIZE })
  const [preloadReady, setPreloadReady] = useState(() => deps.preload === undefined)
  const [preloadError, setPreloadError] = useState(false)
  const [preloadAttempt, setPreloadAttempt] = useState(0)
  const preloadStartedRef = useRef(false)
  /** 지연 청크의 뷰 빌더가 준비되면 올라가 뷰를 다시 만든다(빌더가 늦게 도착해도 빈 뷰에 머물지 않게). */
  const [builderTick, setBuilderTick] = useState(0)

  const summaryQuery = useQuery({ ...historySummaryQueryOptions(deps.gateway), enabled: deps.enabled })
  const snapshot = useQuery({ ...usageQueryOptions(usageDeps.gateway, provider), enabled: deps.enabled })
  const { state: usageState } = useUsage(provider)
  const dataQuery = useQuery({ ...historyDataQueryOptions(deps, provider), enabled: deps.enabled && (open || summaryQuery.isError) })
  const record = dataQuery.data ?? null

  const range = useStore(deps.prefs, (state) => prefsOf(state, provider).range)
  const bucketQuery = useQuery({ ...historyBucketsQueryOptions(deps, provider), enabled: deps.enabled && open && range === '30d' })
  const bucketRecord = useMemo(
    () => bucketQuery.data === undefined ? null : bucketRecordFromPage(bucketQuery.data, new Date(deps.nowMs()).toISOString(), record),
    [bucketQuery.data, record, deps.nowMs],
  )
  const activeRecord = range === '30d' ? bucketRecord : record
  const hidden = useStore(deps.prefs, (state) => state.providers[provider]?.hidden)
  const shown = useStore(deps.prefs, (state) => state.providers[provider]?.shown)

  const runAt = snapshot.data?.collection?.runAt ?? null
  const tailEnd = (() => {
    const fetchedAt = snapshot.data?.collection?.fetchedAt
    const ms = fetchedAt === null || fetchedAt === undefined ? NaN : Date.parse(fetchedAt)
    return Number.isFinite(ms) ? ms : null
  })()

  // 카드에서 본 라벨을 레코드에 기억한다(바뀐 것만).
  const cardLabels = useMemo<Record<string, string>>(() => {
    const labels: Record<string, string> = {}
    for (const item of [...(usageState.report?.windows ?? []), ...(usageState.report?.metrics ?? [])]) labels[item.id] = item.label
    return labels
  }, [usageState.report])

  // 패널 조작·동기화 완료 시점에 최신 값을 ref로 읽는다.
  const latest = useRef({ record, range, cardLabels })
  latest.current = { record, range, cardLabels }

  // 동기화: 패널이 열려 있고 레코드·스냅샷을 읽은 뒤에 시작한다. 중간 조각마다 부분 데이터를 흘리지 않고 완료 시 한 번에 반영한다.
  const syncQuery = useQuery({
    queryKey: [...historySyncKey(provider), runAt ?? 'none', range],
    enabled: deps.enabled && open && range !== '30d' && dataQuery.isSuccess && !snapshot.isPending,
    staleTime: Infinity,
    gcTime: HISTORY_DATA_GC_MS,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HistoryCacheRecord> => {
      const outcome = await runDedupedSync(
        deps.inflight,
        {
          gateway: deps.gateway,
          cache: deps.cache,
          memory: deps.memory,
          nowMs: deps.nowMs,
          budget: deps.budget,
        },
        // 동기화 범위 계산(wantFromMs)은 표시용 공유 클록(usageState.nowIso)과 분리해 저장/동기화 시계(deps.nowMs)를 쓴다.
        { provider, snapshotRunAt: runAt, wantFromMs: deps.nowMs() - RANGE_MS[range] },
      )
      if (outcome.record !== null) {
        const labeled = withLabels(outcome.record, latest.current.cardLabels)
        if (labeled !== outcome.record) {
          if (deps.memory.has(provider)) deps.memory.set(provider, labeled)
          else void deps.cache.update(provider, (current) => (current === null ? null : withLabels(current, latest.current.cardLabels)))
        }
        const prev = client.getQueryData<HistoryCacheRecord | null>(historyDataKey(provider)) ?? null
        const sameRecord =
          prev !== null &&
          prev.coveredFrom === labeled.coveredFrom &&
          prev.cursor === labeled.cursor &&
          prev.samples.length === labeled.samples.length &&
          prev === withLabels(prev, latest.current.cardLabels)
        if (!sameRecord) client.setQueryData(historyDataKey(provider), labeled)
      }
      const synced = throwForOutcome(outcome)
      void client.invalidateQueries({ queryKey: historyWarmKey }) // 레코드가 생겼으니 워밍 대상에 들어간다
      return synced
    },
  })

  useEffect(() => {
    if (record === null) return
    const next = withLabels(record, cardLabels)
    if (next === record) return
    client.setQueryData(historyDataKey(provider), next)
    if (deps.memory.has(provider)) deps.memory.set(provider, next)
    else void deps.cache.update(provider, (current) => (current === null ? null : withLabels(current, cardLabels)))
  }, [record, cardLabels, client, deps, provider])

  // 버튼
  const eligibility = useMemo<HistoryEligibility | 'pending' | 'unknown'>(() => {
    if (summaryQuery.isPending) return 'pending'
    if (summaryQuery.isError) {
      const local = activeRecord === null ? null : historyEligibility(summaryEntryFromRecord(activeRecord))
      return local?.eligible === true ? local : 'unknown'
    }
    return historyEligibility(summaryQuery.data?.find((entry) => entry.provider === provider) ?? null)
  }, [summaryQuery.isPending, summaryQuery.isError, summaryQuery.data, activeRecord, provider])

  const toggle = useCallback(() => {
    if (!deps.enabled) return
    setOpen((current) => {
      const next = !current
      const others = readOpenPanels(deps.session).filter((id) => id !== provider)
      writeOpenPanels(deps.session, next ? [...others, provider] : others)
      return next
    })
  }, [deps.enabled, deps.session, provider])
  const startPreload = useCallback(() => {
    if (deps.preload === undefined || preloadStartedRef.current) return
    preloadStartedRef.current = true
    setPreloadError(false)
    try {
      void Promise.resolve(deps.preload()).then(
        () => {
          setPreloadReady(true)
          setBuilderTick((tick) => tick + 1)
        },
        () => {
          setPreloadError(true)
          setPreloadReady(true)
        },
      )
    } catch {
      setPreloadError(true)
      setPreloadReady(true)
    }
  }, [deps])

  const onIntent = useCallback(() => {
    if (!deps.enabled) return
    startPreload()
  }, [deps.enabled, startPreload])
  // 패널이 열리면(호버·포커스 없이 열려도) 뷰 빌더를 받아 둔다. 실패 시 무한 스피너 대신 에러 상태로 전환한다.
  useEffect(() => {
    if (!deps.enabled || !open) return
    startPreload()
  }, [deps.enabled, open, preloadAttempt, startPreload])

  const button: ChartButtonState = !deps.enabled
    ? { label: (t('chart.open') as ChartButtonState['label']), expanded: false, disabled: true, hint: null, panelId, onToggle: toggle, onIntent }
    : {
        label: open ? (t('chart.close') as ChartButtonState['label']) : (t('chart.open') as ChartButtonState['label']),
        expanded: open,
        disabled: eligibility === 'pending' || eligibility === 'unknown' || !eligibility.eligible,
        hint: eligibility === 'pending' ? null : eligibility === 'unknown' ? t('chart.hint.unknown') : hintFor(eligibility),
        panelId,
        onToggle: toggle,
        onIntent,
      }

  const actions = useMemo<ChartPanelActions>(
    () => ({
      onSelectRange: (next) => {
        deps.prefs.getState().setRange(provider, next)
      },
      onToggleSeries: (seriesId) => {
        const order = latest.current.record?.seriesOrder ?? []
        const index = order.indexOf(seriesId)
        deps.prefs.getState().toggleSeries(provider, seriesId, index >= 8)
      },
      onShowAllSeries: () => deps.prefs.getState().showAll(provider),
      onRetry: () => {
        if (deps.preload !== undefined) {
          preloadStartedRef.current = false
          setPreloadReady(false)
          setPreloadError(false)
          setPreloadAttempt((n) => n + 1)
        }
        if (range === '30d') void bucketQuery.refetch()
        else void syncQuery.refetch()
      },
      onResize: (next) => setSize((current) => (current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height })),
    }),
    [deps, provider, range, bucketQuery.refetch, syncQuery.refetch],
  )

  // 스피너는 선택 범위에 그릴 성공 표본이 하나도 없을 때만 표시한다.
  // 이미 그릴 표본이 있으면 범위 확장·백그라운드 sync·탭 재방문 중에도 기존 차트를 유지하고 완료 시 한 번만 교체한다.
  const waitingForHistory = range === '30d' ? bucketQuery.isFetching : syncQuery.isPending || syncQuery.isFetching
  const hasDrawable = hasDrawableSuccess(
    activeRecord,
    range,
    usageState.nowIso === null ? deps.nowMs() : Date.parse(usageState.nowIso),
  )
  const isInitialLoading = activeRecord === null && ((range === '30d' ? bucketQuery.isPending : dataQuery.isPending) || snapshot.isPending || waitingForHistory)
  const isUncoveredSwitch = !hasDrawable && waitingForHistory
  const isLoading = !preloadReady || isInitialLoading || isUncoveredSwitch

  const prevViewRef = useRef<{ view: ChartView; key: string } | null>(null)
  const buildView = resolveViewBuilder(deps)
  const view = useMemo(() => {
    if (isLoading || preloadError || activeRecord === null) {
      prevViewRef.current = null
      return null
    }
    // 범위·모드는 sync 완료 시 새 데이터로 한 번만 교체한다. hidden/size/builder 변경은 즉시 반영한다.
    const uiKey = `${range}|${range === '30d' ? 'bucket' : 'raw'}|${(hidden ?? NONE).join(',')}|${(shown ?? NONE).join(',')}|${size.width}x${size.height}|${builderTick}`
    if (waitingForHistory && prevViewRef.current !== null && prevViewRef.current.key === uiKey) {
      return prevViewRef.current.view
    }
    const nowMs = usageState.nowIso === null ? deps.nowMs() : Date.parse(usageState.nowIso)
    const built = buildView({
      provider,
      providerTitle: meta.title,
      record: activeRecord,
      tailEnd,
      range,
      hidden: hidden ?? NONE,
      shown: shown ?? NONE,
      cardLabels,
      size,
      nowMs,
      windows: usageState.report?.windows,
    })
    prevViewRef.current = { view: built, key: uiKey }
    return built
  }, [waitingForHistory, isLoading, preloadError, buildView, builderTick, provider, meta.title, activeRecord, tailEnd, range, hidden, shown, cardLabels, size, usageState.nowIso, deps, usageState.report])

  if (!deps.enabled || !open) return { button, panel: null }
  const partialNote = range === '30d' && bucketQuery.data?.complete === false ? t('chart.note.partial') : null
  const errorMessage = preloadError
    ? t('chart.loadFailed')
    : range === '30d'
      ? bucketQuery.error instanceof UsageLoadError
        ? bucketQuery.error.message
        : bucketQuery.isError
          ? t('chart.loadFailed')
          : null
      : syncQuery.error instanceof UsageLoadError
        ? syncQuery.error.message
        : syncQuery.isError
          ? t('chart.loadFailed')
          : null
  const state: ChartPanelState =
    isLoading
      ? { phase: 'loading' }
      : preloadError
        ? { phase: 'error', message: t('chart.loadFailed') }
        : view === null
          ? errorMessage !== null
            ? { phase: 'error', message: errorMessage }
            : { phase: 'loading' }
          : { phase: 'ready', view, syncing: range === '30d' ? bucketQuery.isFetching : syncQuery.isFetching, note: errorMessage ?? partialNote }
  return { button, panel: { panelId, regionLabel: t('chart.regionLabel', { provider: meta.title }), range, state, actions } }
}
