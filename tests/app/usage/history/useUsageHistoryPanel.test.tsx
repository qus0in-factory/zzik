// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore, prefsOf } from '@app/usage/history/chart-prefs-store'
import { emptyChartViewBuilder } from '@app/usage/history/chart-view-input'
import type { ChartViewInput } from '@app/usage/history/chart-view-input'
import { CHART_OPEN_KEY, readOpenPanels, useUsageHistoryPanel } from '@app/usage/history/useUsageHistoryPanel'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { createRecord, applyForward } from '@domain/usage/history/record'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageHistorySample, UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import normalRaw from '../../../fixtures/claude-usage.normal.json'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue, syntheticEvents } from '../../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../../fakes/usage-ports'
import { createTestQueryClient } from '../../../helpers/query'

afterEach(cleanup)

const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const RUN_AT = '2026-11-14T11:45:00.000Z'
const COLLECTION = { schema: 1, provider: 'claude', status: 'ok', called: true, runAt: RUN_AT, fetchedAt: RUN_AT, httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 900, collectorVersion: 'x', rawOmitted: null } as const
const eligible: UsageHistorySummaryEntry = { provider: 'claude', okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' }

function harness(options: { events?: UsageHistorySample[]; summary?: UsageHistorySummaryEntry[] | 'fail'; record?: HistoryCacheRecord; session?: Record<string, string> } = {}) {
  const server = createFakeHistoryServer('claude', options.events ?? syntheticEvents(12, new Date(NOW - 6 * 3_600_000).toISOString()))
  const gateway = createFakeHistoryGateway({ claude: server })
  if (options.summary === 'fail') gateway.fetchSummary = async () => ({ ok: false, reason: 'network_error', message: null })
  else gateway.summary = options.summary ?? [eligible]
  const cache = createFakeHistoryCache(options.record === undefined ? [] : [options.record])
  const session = createMemoryKeyValue(options.session)
  const prefs = createChartPrefsStore(createMemoryKeyValue())
  const inputs: ChartViewInput[] = []
  const deps: HistoryDeps = {
    enabled: true,
    gateway,
    cache,
    session,
    prefs,
    budget: createHistoryBudget({ now: () => NOW }),
    memory: new Map(),
    inflight: new Map(),
    nowMs: () => NOW,
    preload: () => void (preloaded.count += 1),
    buildView: (input) => (inputs.push(input), emptyChartViewBuilder(input)),
  }
  const preloaded = { count: 0 }
  const usage = createFakeUsageGateway()
  usage.pushResult({ ok: true, usage: normalRaw, collection: COLLECTION, rawText: null })
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() }}>
        <HistoryDepsProvider deps={deps}>{children}</HistoryDepsProvider>
      </UsageGatewayProvider>
    </QueryClientProvider>
  )
  return { gateway, cache, session, prefs, inputs, deps, preloaded, wrapper, server }
}

describe('Given the history panel button state (10절)', () => {
  it('When the summary says eligible Then the button is enabled, labeled 차트 보기, with aria wiring ids', async () => {
    const h = harness()
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.button.disabled).toBe(false))
    expect(result.current.button).toMatchObject({ label: '차트 보기', expanded: false, hint: null, panelId: 'usage-history-claude' })
    expect(result.current.panel).toBeNull()
  })
  it('When the summary is still loading Then disabled without a reason', () => {
    const h = harness()
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    expect(result.current.button).toMatchObject({ disabled: true, hint: null })
  })
  it.each([
    [[], '아직 기록된 이력이 없습니다'],
    [[{ provider: 'claude', okCount: 3, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' }], '변화 기록이 4건 이상 쌓이면 볼 수 있습니다 (현재 3건)'],
    [[{ provider: 'claude', okCount: 4, firstOkAt: '2026-11-14T00:00:00.000Z', lastOkAt: '2026-11-14T04:00:00.000Z' }], '첫 기록 후 6시간이 지나면 볼 수 있습니다 (약 2시간 남음)'],
  ] as const)('When the summary is %j Then disabled with the reason', async (summary, hint) => {
    const h = harness({ summary: [...summary] })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.button.hint).toBe(hint))
    expect(result.current.button.disabled).toBe(true)
  })
  it('When the summary fails and no record exists Then disabled with the unknown-status reason', async () => {
    const h = harness({ summary: 'fail' })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.button.hint).toBe('이력 상태를 확인하지 못했습니다'))
  })
  it('When the summary fails but this browser has enough ok samples cached Then the button is enabled', async () => {
    const base = createRecord('claude', '2026-11-14T00:00:00.000Z')
    const record = { ...base, samples: syntheticEvents(5, '2026-11-13T00:00:00.000Z', 3 * 3_600_000) }
    const h = harness({ summary: 'fail', record })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.button.disabled).toBe(false))
  })
  it('When the pointer or focus touches the button Then onIntent asks the preloader', async () => {
    const h = harness()
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    act(() => result.current.button.onIntent())
    expect(h.preloaded.count).toBe(1)
  })
})

describe('Given opening the panel', () => {
  it('When toggled Then expanded, the panel exists with its region label, and the tab state is saved in sessionStorage', async () => {
    const h = harness()
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.button.disabled).toBe(false))
    act(() => result.current.button.onToggle())
    expect(result.current.button).toMatchObject({ expanded: true, label: '차트 닫기' })
    expect(result.current.panel).toMatchObject({ panelId: 'usage-history-claude', regionLabel: 'Claude 사용률 추이', range: '7d' })
    expect(JSON.parse(h.session.data.get(CHART_OPEN_KEY) ?? 'null')).toEqual({ v: 1, open: ['claude'] })
    act(() => result.current.button.onToggle())
    expect(result.current.panel).toBeNull()
    expect(h.session.data.has(CHART_OPEN_KEY)).toBe(false)
  })
  it('When the tab already had it open Then it is restored', async () => {
    const h = harness({ session: { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) } })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    expect(result.current.button.expanded).toBe(true)
  })
  it('When closed Then no history samples are requested', async () => {
    const h = harness()
    renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(h.gateway.summaryCalls).toBe(1))
    expect(h.gateway.queries).toHaveLength(0)
  })
  it('When opened with a cached record Then the cached chart is shown first (ready) and then synced', async () => {
    const events = syntheticEvents(12, new Date(NOW - 6 * 3_600_000).toISOString())
    const first = createFakeHistoryServer('claude', events.slice(0, 6)).page({ from: new Date(NOW - 86_400_000).toISOString(), limit: 50, anchor: true })
    const record = applyForward(null, null, first, { provider: 'claude', now: new Date(NOW).toISOString(), initialFrom: new Date(NOW - 86_400_000).toISOString() })!
    const h = harness({ events, record, session: { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) } })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
    await waitFor(() => expect(h.cache.records.get('claude')?.samples).toHaveLength(12))
    expect(h.gateway.queries[0]).toMatchObject({ after: expect.stringMatching(/_6$/) })
  })
  it('When the first sync completes Then the record exists, labels come from the card, and the view builder gets the range and tail', async () => {
    const h = harness({ session: { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) } })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(h.cache.records.get('claude')?.samples).toHaveLength(12))
    await waitFor(() => expect(h.inputs.at(-1)?.cardLabels.five_hour).toBe('5시간 한도'))
    const input = h.inputs.at(-1)!
    expect(input).toMatchObject({ provider: 'claude', providerTitle: 'Claude', range: '7d', tailEnd: Date.parse(RUN_AT), size: { width: 640, height: 240 } })
    await waitFor(() => expect(h.cache.records.get('claude')?.labels.five_hour).toBe('5시간 한도'))
    expect(result.current.panel?.state).toMatchObject({ phase: 'ready' })
  })
})

describe('Given panel actions', () => {
  const open = { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) }
  it('When a range is selected Then it is saved and the next view uses it', async () => {
    const h = harness({ session: open })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
    act(() => result.current.panel?.actions.onSelectRange('30d'))
    expect(prefsOf(h.prefs.getState(), 'claude').range).toBe('30d')
    await waitFor(() => expect(result.current.panel?.range).toBe('30d'))
    await waitFor(() => expect(h.inputs.at(-1)?.range).toBe('30d'))
  })
  it('When a series is toggled Then hidden changes (slot 1~8) and show-all clears it', async () => {
    const h = harness({ session: open })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(h.cache.records.get('claude')?.seriesOrder).toContain('five_hour'))
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
    act(() => result.current.panel?.actions.onToggleSeries('five_hour'))
    expect(prefsOf(h.prefs.getState(), 'claude').hidden).toEqual(['five_hour'])
    await waitFor(() => expect(h.inputs.at(-1)?.hidden).toEqual(['five_hour']))
    act(() => result.current.panel?.actions.onShowAllSeries())
    expect(prefsOf(h.prefs.getState(), 'claude').hidden).toEqual([])
  })
  it('When the panel reports its size Then the view is rebuilt with it; the actions object keeps its identity', async () => {
    const h = harness({ session: open })
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
    const actions = result.current.panel?.actions
    act(() => actions?.onResize({ width: 800, height: 200 }))
    await waitFor(() => expect(h.inputs.at(-1)?.size).toEqual({ width: 800, height: 200 }))
    expect(result.current.panel?.actions).toBe(actions)
  })
})

describe('Given failures', () => {
  const open = { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) }
  it('When the first sync fails and nothing is cached Then the panel shows an error, and retry runs it again', async () => {
    const h = harness({ session: open })
    h.gateway.failAt.add(1)
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('error'))
    h.gateway.failAt.clear()
    act(() => result.current.panel?.actions.onRetry())
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
  })
  it('When the server has another scanVersion Then the cached chart stays and a refresh note is shown (I6)', async () => {
    const events = syntheticEvents(12, new Date(NOW - 6 * 3_600_000).toISOString())
    const first = createFakeHistoryServer('claude', events.slice(0, 6)).page({ from: new Date(NOW - 86_400_000).toISOString(), limit: 50, anchor: true })
    const record = applyForward(null, null, first, { provider: 'claude', now: new Date(NOW).toISOString(), initialFrom: new Date(NOW - 86_400_000).toISOString() })!
    const h = harness({ events, record, session: open })
    h.gateway.mismatchAt.add(1)
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect((result.current.panel?.state as { note?: string | null }).note).toContain('새 버전이 배포되었습니다'))
    expect(result.current.panel?.state.phase).toBe('ready')
    expect(h.cache.records.get('claude')?.samples).toHaveLength(6)
  })
})

describe('Given a view builder that arrives late (지연 청크)', () => {
  it('When the panel opens without hover and the builder loads afterwards Then the view is rebuilt with the loaded builder', async () => {
    const h = harness({ session: { [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) } })
    let current: ReturnType<typeof emptyChartViewBuilder> extends infer V ? (input: ChartViewInput) => V : never = emptyChartViewBuilder
    h.deps.buildView = (input) => current(input)
    h.deps.preload = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          current = (input) => ({ ...emptyChartViewBuilder(input), title: 'LOADED' })
          resolve()
        }, 30),
      )
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: h.wrapper })
    await waitFor(() => expect(result.current.panel?.state.phase).toBe('ready'))
    await waitFor(() => expect((result.current.panel?.state as { view: { title: string } }).view.title).toBe('LOADED'))
  })
})

describe('Given the sessionStorage open-panel list (N4: 정규화)', () => {
  const read = (open: unknown) => readOpenPanels(createMemoryKeyValue({ [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open }) }))
  it('Then only known providers survive, duplicates are removed and at most six remain', () => {
    expect(read(['claude', 'nope', 'claude', 7, null, 'codex'])).toEqual(['claude', 'codex'])
    expect(read(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama', 'claude', 'x'])).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
    expect(read(Array.from({ length: 20 }, () => 'grok'))).toEqual(['grok'])
  })
  it('Then broken storage yields an empty list', () => {
    expect(readOpenPanels(createMemoryKeyValue({ [CHART_OPEN_KEY]: '{oops' }))).toEqual([])
    expect(readOpenPanels(createMemoryKeyValue({ [CHART_OPEN_KEY]: JSON.stringify({ v: 2, open: ['claude'] }) }))).toEqual([])
    expect(read('claude')).toEqual([])
  })
})

