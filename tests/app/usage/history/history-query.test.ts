import { describe, expect, it } from 'vitest'
import { runDedupedSync } from '@app/usage/history/history-query'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import type { SyncDeps, SyncOutcome } from '@app/usage/history/sync-history'
import type { UsageProvider } from '@domain/usage/providers'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, syntheticEvents } from '../../../fakes/history-ports'
import { createDeferred } from '../../../fakes/usage-ports'

const NOW = Date.parse('2026-11-14T12:00:00.000Z')

describe('Given a shared history sync with more than one consumer', () => {
  it('When the first consumer aborts but another is active Then the sync finishes for the survivor', async () => {
    const server = createFakeHistoryServer('claude', syntheticEvents(120, new Date(NOW - 11 * 3_600_000).toISOString()))
    const gateway = createFakeHistoryGateway({ claude: server })
    const cache = createFakeHistoryCache()
    const deps: SyncDeps = { gateway, cache, memory: new Map(), nowMs: () => NOW, budget: createHistoryBudget({ now: () => NOW }) }
    const inflight = new Map<UsageProvider, Promise<SyncOutcome>>()
    const gate = createDeferred<void>()
    const started = createDeferred<void>()
    gateway.onBeforeFetch = async () => {
      started.resolve()
      await gate.promise
    }

    const first = new AbortController()
    const second = new AbortController()
    const firstRun = runDedupedSync(inflight, deps, { provider: 'claude', snapshotRunAt: null, wantFromMs: null }, first.signal)
    await started.promise
    const secondRun = runDedupedSync(inflight, deps, { provider: 'claude', snapshotRunAt: null, wantFromMs: null }, second.signal)
    first.abort()
    gate.resolve()

    const [survivor, aborted] = await Promise.all([secondRun, firstRun])
    expect(survivor.ok).toBe(true)
    expect(aborted.ok).toBe(true)
    expect(gateway.queries.length).toBeGreaterThan(1)
  })
})
