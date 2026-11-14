import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from 'zustand'
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../../shared/usage-history-contract'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import { historyEligibility } from '@domain/usage/history/eligibility'
import type { HistoryEligibility } from '@domain/usage/history/eligibility'
import type { KeyValueStorage } from '@domain/usage/history/ports'
import { withLabels } from '@domain/usage/history/record'
import type { ChartRange, HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { t } from '@shared/messages'
import { usageQueryOptions, UsageLoadError } from '../usage-query'
import { providerMetaFor } from '../provider-meta'
import { useUsage } from '../useUsage'
import { useUsageDeps } from '../UsageGatewayContext'
import type { ChartButtonState, ChartPanelActions, ChartPanelState, UsageHistoryPanelBinding } from './chart-view'
import { DEFAULT_CHART_SIZE, RANGE_MESSAGE_KEY } from './chart-view-input'
import { prefsOf } from './chart-prefs-store'
import { resolveViewBuilder, useHistoryDeps } from './HistoryDepsContext'
import { HISTORY_DATA_GC_MS, historyDataKey, historyWarmKey, historyDataQueryOptions, historySummaryQueryOptions, historySyncKey, runDedupedSync, throwForOutcome } from './history-query'

/** 이 탭에서 열어 둔 패널(sessionStorage). 같은 탭의 새로고침·재로그인 복귀에서만 복원된다. */
export const CHART_OPEN_KEY = 'zzik:chart-open:v1'
const NONE: readonly string[] = []
const RANGE_MS: Record<ChartRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

export function readOpenPanels(storage: KeyValueStorage): UsageProvider[] {
  try {
    const value: unknown = JSON.parse(storage.get(CHART_OPEN_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 1) return []
    const open = (value as { open?: unknown }).open
    return Array.isArray(open) ? (open.filter((item): item is UsageProvider => typeof item === 'string') as UsageProvider[]) : []
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
  const [progress, setProgress] = useState<string | null>(null)
  /** 지연 청크의 뷰 빌더가 준비되면 올라가 뷰를 다시 만든다(빌더가 늦게 도착해도 빈 뷰에 머물지 않게). */
  const [builderTick, setBuilderTick] = useState(0)

  const summaryQuery = useQuery({ ...historySummaryQueryOptions(deps.gateway), enabled: deps.enabled })
  const snapshot = useQuery({ ...usageQueryOptions(usageDeps.gateway, provider), enabled: deps.enabled })
  const { state: usageState } = useUsage(provider)
  const dataQuery = useQuery({ ...historyDataQueryOptions(deps, provider), enabled: deps.enabled && (open || summaryQuery.isError) })
  const record = dataQuery.data ?? null

  const range = useStore(deps.prefs, (state) => prefsOf(state, provider).range)
  const hidden = useStore(deps.prefs, (state) => state.providers[provider]?.hidden)
  const shown = useStore(deps.prefs, (state) => state.providers[provider]?.shown)

  const runAt = snapshot.data?.collection?.runAt ?? null
  const tailEnd = (() => {
    const fetchedAt = snapshot.data?.collection?.fetchedAt
    const ms = fetchedAt === null || fetchedAt === undefined ? NaN : Date.parse(fetchedAt)
    return Number.isFinite(ms) ? ms : null
  })()

  // 동기화: 패널이 열려 있고 레코드를 읽은 뒤에 시작한다. 스냅샷 runAt·범위가 바뀌면 다시 돈다(생략 규칙은 syncHistory가 판단).
  const syncQuery = useQuery({
    queryKey: [...historySyncKey(provider), runAt ?? 'none', range],
    enabled: deps.enabled && open && dataQuery.isSuccess,
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
          onRecord: (next) => client.setQueryData(historyDataKey(provider), next),
          onProgress: (done, total) => setProgress(done >= total ? null : t('chart.progress', { range: t(RANGE_MESSAGE_KEY[range]), done, total })),
        },
        { provider, snapshotRunAt: runAt, wantFromMs: deps.nowMs() - RANGE_MS[range] },
      )
      setProgress(null)
      const synced = throwForOutcome(outcome)
      void client.invalidateQueries({ queryKey: historyWarmKey }) // 레코드가 생겼으니 워밍 대상에 들어간다
      return synced
    },
  })

  // 카드에서 본 라벨을 레코드에 기억한다(바뀐 것만).
  const cardLabels = useMemo<Record<string, string>>(() => {
    const labels: Record<string, string> = {}
    for (const item of [...(usageState.report?.windows ?? []), ...(usageState.report?.metrics ?? [])]) labels[item.id] = item.label
    return labels
  }, [usageState.report])
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
      const local = record === null ? null : historyEligibility(summaryEntryFromRecord(record))
      return local?.eligible === true ? local : 'unknown'
    }
    return historyEligibility(summaryQuery.data?.find((entry) => entry.provider === provider) ?? null)
  }, [summaryQuery.isPending, summaryQuery.isError, summaryQuery.data, record, provider])

  const toggle = useCallback(() => {
    if (!deps.enabled) return
    setOpen((current) => {
      const next = !current
      const others = readOpenPanels(deps.session).filter((id) => id !== provider)
      writeOpenPanels(deps.session, next ? [...others, provider] : others)
      return next
    })
  }, [deps.enabled, deps.session, provider])
  const onIntent = useCallback(() => {
    if (deps.enabled) void Promise.resolve(deps.preload?.()).then(() => setBuilderTick((tick) => tick + 1))
  }, [deps])
  // 패널이 열리면(호버·포커스 없이 열려도) 뷰 빌더를 받아 둔다.
  useEffect(() => {
    if (!deps.enabled || !open) return
    let active = true
    void Promise.resolve(deps.preload?.()).then(() => {
      if (active) setBuilderTick((tick) => tick + 1)
    })
    return () => {
      active = false
    }
  }, [deps, open])

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

  // 패널 조작: 참조가 유지되도록 최신 값은 ref로 읽는다.
  const latest = useRef({ record, range })
  latest.current = { record, range }
  const actions = useMemo<ChartPanelActions>(
    () => ({
      onSelectRange: (next) => deps.prefs.getState().setRange(provider, next),
      onToggleSeries: (seriesId) => {
        const order = latest.current.record?.seriesOrder ?? []
        const index = order.indexOf(seriesId)
        deps.prefs.getState().toggleSeries(provider, seriesId, index >= 8)
      },
      onShowAllSeries: () => deps.prefs.getState().showAll(provider),
      onRetry: () => void syncQuery.refetch(),
      onResize: (next) => setSize((current) => (current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height })),
    }),
    [deps.prefs, provider, syncQuery.refetch],
  )

  const buildView = resolveViewBuilder(deps)
  const view = useMemo(
    () => (record === null ? null : buildView({ provider, providerTitle: meta.title, record, tailEnd, range, hidden: hidden ?? NONE, shown: shown ?? NONE, cardLabels, size, nowMs: deps.nowMs() })),
    [buildView, builderTick, provider, meta.title, record, tailEnd, range, hidden, shown, cardLabels, size],
  )

  if (!deps.enabled || !open) return { button, panel: null }
  const errorMessage = syncQuery.error instanceof UsageLoadError ? syncQuery.error.message : syncQuery.isError ? t('chart.loadFailed') : null
  const state: ChartPanelState =
    view === null
      ? errorMessage !== null
        ? { phase: 'error', message: errorMessage }
        : { phase: 'loading' }
      : { phase: 'ready', view, syncing: syncQuery.isFetching, progress, note: errorMessage }
  return { button, panel: { panelId, regionLabel: t('chart.regionLabel', { provider: meta.title }), range, state, actions } }
}
