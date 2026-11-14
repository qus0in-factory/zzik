// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { IDBFactory } from 'fake-indexeddb'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { createDisabledHistoryDeps, HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { CHART_OPEN_KEY, useUsageHistoryPanel } from '@app/usage/history/useUsageHistoryPanel'
import { useHistoryWarmSync } from '@app/usage/history/useHistoryWarmSync'
import { createIdbHistoryCache } from '@infra/usage/idb-history-cache'
import { createRecord } from '@domain/usage/history/record'
import normalRaw from '../../../fixtures/claude-usage.normal.json'
import { createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue, syntheticEvents } from '../../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../../fakes/usage-ports'
import { createTestQueryClient } from '../../../helpers/query'

afterEach(cleanup)

/** 기능 플래그가 꺼진 상태(기본): 이력 HTTP 호출 0, IndexedDB open 0, 어떤 저장소 쓰기도 0 (ADR 0.7 후속: 데이터 계층을 꺼진 채로 먼저 배포). */
function setup(enabled: boolean) {
  const gateway = createFakeHistoryGateway({ claude: createFakeHistoryServer('claude', syntheticEvents(8, '2026-11-14T06:00:00.000Z')) })
  gateway.summary = [{ provider: 'claude', okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' }]
  const idb = new IDBFactory()
  let opens = 0
  const factory = { open: (...args: Parameters<IDBFactory['open']>) => (opens += 1, idb.open(...args)) } as unknown as IDBFactory
  const cache = createIdbHistoryCache(factory)
  const session = createMemoryKeyValue({ [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) })
  const prefsStorage = createMemoryKeyValue()
  const deps: HistoryDeps = {
    enabled,
    gateway,
    cache,
    session,
    prefs: createChartPrefsStore(prefsStorage),
    budget: createHistoryBudget({ now: () => 0 }),
    memory: new Map(),
    inflight: new Map(),
    nowMs: () => Date.parse('2026-11-14T12:00:00.000Z'),
  }
  const usage = createFakeUsageGateway()
  usage.pushResult({ ok: true, usage: normalRaw, collection: null, rawText: null })
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() }}>
        <HistoryDepsProvider deps={deps}>{children}</HistoryDepsProvider>
      </UsageGatewayProvider>
    </QueryClientProvider>
  )
  return { gateway, opens: () => opens, session, wrapper, deps }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

describe('Given the history feature flag is OFF', () => {
  it('When the panel hook renders (even with a stored open panel) Then no request, no IndexedDB open, and the button is inert', async () => {
    const t = setup(false)
    const { result } = renderHook(() => useUsageHistoryPanel('claude'), { wrapper: t.wrapper })
    await settle()
    expect(t.gateway.summaryCalls).toBe(0)
    expect(t.gateway.queries).toHaveLength(0)
    expect(t.opens()).toBe(0)
    expect(result.current.panel).toBeNull()
    expect(result.current.button).toMatchObject({ disabled: true, expanded: false, hint: null })
    // 눌러도 아무 일도 없다(세션 상태도 바뀌지 않는다)
    const before = t.session.data.get(CHART_OPEN_KEY)
    result.current.button.onToggle()
    result.current.button.onIntent()
    expect(t.session.data.get(CHART_OPEN_KEY)).toBe(before)
    await settle()
    expect(t.opens()).toBe(0)
  })
  it('When the warm sync hook renders Then it does nothing at all', async () => {
    const t = setup(false)
    await t.deps.cache.update('claude', () => createRecord('claude', '2026-11-14T00:00:00.000Z')) // 준비 단계에서만 연다
    const openedBySetup = t.opens()
    renderHook(() => useHistoryWarmSync(), { wrapper: t.wrapper })
    await settle()
    expect(t.gateway.queries).toHaveLength(0)
    expect(t.gateway.summaryCalls).toBe(0)
    expect(t.opens()).toBe(openedBySetup)
  })
  it('Then the disabled deps used by the assembly root are inert: no ports are ever touched', async () => {
    const deps = createDisabledHistoryDeps()
    expect(deps.enabled).toBe(false)
    expect(await deps.cache.read('claude')).toBeNull()
    expect(await deps.cache.listProviders()).toEqual([])
    expect(await deps.gateway.fetchSummary()).toMatchObject({ ok: false })
    expect(await deps.gateway.fetchSamples('claude', { limit: 50 })).toMatchObject({ ok: false })
  })
})

describe('Given the flag is ON (회귀: 켜면 동작한다)', () => {
  it('When the panel hook renders Then the summary is requested', async () => {
    const t = setup(true)
    renderHook(() => useUsageHistoryPanel('claude'), { wrapper: t.wrapper })
    await settle()
    expect(t.gateway.summaryCalls).toBe(1)
  })
})
