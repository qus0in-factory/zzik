// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { useHistoryWarmSync } from '@app/usage/history/useHistoryWarmSync'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { applyForward, withSync } from '@domain/usage/history/record'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import normalRaw from '../../../fixtures/claude-usage.normal.json'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue, syntheticEvents } from '../../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../../fakes/usage-ports'
import { createTestQueryClient } from '../../../helpers/query'

afterEach(() => {
  cleanup()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const RUN_AT = '2026-11-14T11:45:00.000Z'
const collection = (provider: UsageProvider) => ({ schema: 1, provider, status: 'ok', called: true, runAt: RUN_AT, fetchedAt: RUN_AT, httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 900, collectorVersion: 'x', rawOmitted: null }) as const

function record(provider: UsageProvider, events: ReturnType<typeof syntheticEvents>, syncedThrough: string | null): HistoryCacheRecord {
  const server = createFakeHistoryServer(provider, events)
  const first = server.page({ from: new Date(NOW - 86_400_000).toISOString(), limit: 50, anchor: true })
  const base = applyForward(null, null, first, { provider, now: new Date(NOW).toISOString(), initialFrom: new Date(NOW - 86_400_000).toISOString() })!
  return withSync(base, syncedThrough, new Date(NOW).toISOString())
}

function harness(providersWithRecords: UsageProvider[], syncedThrough: string | null = '2026-11-14T11:30:00.000Z') {
  const events = syntheticEvents(8, new Date(NOW - 5 * 3_600_000).toISOString())
  const servers = Object.fromEntries(USAGE_PROVIDERS.map((provider) => [provider, createFakeHistoryServer(provider, events)]))
  const gateway = createFakeHistoryGateway(servers)
  const cache = createFakeHistoryCache(providersWithRecords.map((provider) => record(provider, events.slice(0, 4), syncedThrough)))
  const usage = createFakeUsageGateway()
  for (const provider of USAGE_PROVIDERS) usage.pushResultFor(provider, { ok: true, usage: normalRaw, collection: collection(provider), rawText: null })
  let concurrent = 0
  let maxConcurrent = 0
  gateway.onBeforeFetch = async () => {
    concurrent += 1
    maxConcurrent = Math.max(maxConcurrent, concurrent)
    await new Promise((resolve) => setTimeout(resolve, 5))
    concurrent -= 1
  }
  const deps: HistoryDeps = { gateway, cache, session: createMemoryKeyValue(), prefs: createChartPrefsStore(createMemoryKeyValue()), budget: createHistoryBudget({ now: () => NOW }), memory: new Map(), inflight: new Map(), nowMs: () => NOW }
  const client = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() }}>
        <HistoryDepsProvider deps={deps}>{children}</HistoryDepsProvider>
      </UsageGatewayProvider>
    </QueryClientProvider>
  )
  return { gateway, cache, wrapper, maxConcurrent: () => maxConcurrent }
}

describe('Given the background warm sync (워밍)', () => {
  it('When providers with a cached record see a newer snapshot runAt Then each syncs forward, one at a time', async () => {
    const h = harness(['claude', 'codex'])
    renderHook(() => useHistoryWarmSync(), { wrapper: h.wrapper })
    await waitFor(() => expect(h.cache.records.get('codex')?.syncedThroughRunAt).toBe(RUN_AT))
    expect(h.cache.records.get('claude')?.syncedThroughRunAt).toBe(RUN_AT)
    expect(h.cache.records.get('claude')?.samples).toHaveLength(8)
    expect(h.maxConcurrent()).toBe(1)
    expect(h.gateway.queries.every((query) => query.after !== undefined && query.anchor === undefined)).toBe(true)
  })
  it('When the record is already synced through this runAt Then no request is made (생략 규칙)', async () => {
    const h = harness(['claude'], RUN_AT)
    renderHook(() => useHistoryWarmSync(), { wrapper: h.wrapper })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(h.gateway.queries).toHaveLength(0)
  })
  it('When no provider has a record Then nothing is requested (차트를 열어 본 제공자만)', async () => {
    const h = harness([])
    renderHook(() => useHistoryWarmSync(), { wrapper: h.wrapper })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(h.gateway.queries).toHaveLength(0)
  })
  it('When the document is hidden Then it waits, and runs when it becomes visible', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    const h = harness(['claude'])
    renderHook(() => useHistoryWarmSync(), { wrapper: h.wrapper })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(h.gateway.queries).toHaveLength(0)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(h.cache.records.get('claude')?.syncedThroughRunAt).toBe(RUN_AT))
  })
})
