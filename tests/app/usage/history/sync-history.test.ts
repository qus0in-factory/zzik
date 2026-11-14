import { describe, expect, it } from 'vitest'
import { createHistoryBudget, FIRST_FORWARD_WINDOW_MS, syncHistory } from '@app/usage/history/sync-history'
import type { SyncDeps } from '@app/usage/history/sync-history'
import { createRecord, applyForward } from '@domain/usage/history/record'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageHistorySample } from '../../../../shared/usage-history-contract'
import { USAGE_HISTORY_PAGE_LIMIT } from '../../../../shared/usage-history-contract'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, syntheticEvents } from '../../../fakes/history-ports'

const NOW_ISO = '2026-11-14T12:00:00.000Z'
const NOW = Date.parse(NOW_ISO)
const HOUR = 3_600_000
const DAY = 24 * HOUR

function setup(events: UsageHistorySample[], initial: HistoryCacheRecord[] = []) {
  const server = createFakeHistoryServer('claude', events)
  const gateway = createFakeHistoryGateway({ claude: server })
  const cache = createFakeHistoryCache(initial)
  const memory = new Map<UsageProvider, HistoryCacheRecord>()
  let now = NOW
  const deps = (): SyncDeps => ({ gateway, cache, memory, nowMs: () => now, budget: createHistoryBudget({ now: () => now }) })
  return { server, gateway, cache, memory, deps, setNow: (ms: number) => void (now = ms) }
}

/** I1: 레코드의 표본 = 서버의 [coveredFrom, cursor] 구간 이벤트 */
function expectI1(record: HistoryCacheRecord | undefined, server: ReturnType<typeof createFakeHistoryServer>): void {
  if (record === undefined) return
  expect(record.samples.map((sample) => sample.id)).toEqual(server.expectedSamples(record.coveredFrom, record.cursor).map((sample) => sample.id))
}

describe('Given the forward sync (정방향)', () => {
  it('When there is no record Then it asks for the last 24 hours with anchor=1 and stores coveredFrom with the first page (I2)', async () => {
    const t = setup(syntheticEvents(10, new Date(NOW - 5 * HOUR).toISOString()))
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(outcome.ok).toBe(true)
    expect(t.gateway.queries[0]).toEqual({ from: new Date(NOW - FIRST_FORWARD_WINDOW_MS).toISOString(), limit: USAGE_HISTORY_PAGE_LIMIT, anchor: true })
    const record = t.cache.records.get('claude')!
    expect(record.coveredFrom).toBe(new Date(NOW - DAY).toISOString())
    expect(record.samples).toHaveLength(10)
    expectI1(record, t.server)
  })
  it('When the server has more pages Then it follows nextCursor until hasMore is false', async () => {
    const t = setup(syntheticEvents(120, new Date(NOW - 11 * HOUR).toISOString(), 300_000))
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const record = t.cache.records.get('claude')!
    expect(t.gateway.queries.length).toBeGreaterThanOrEqual(2)
    expect(t.gateway.queries[1].after).toBe(`${t.server.events[49].runAt}_${t.server.events[49].id}`)
    expect(t.gateway.queries[1].from).toBeUndefined()
    expectI1(record, t.server)
  })
  it('When a record exists Then it continues from the cursor (after) with no anchor', async () => {
    const events = syntheticEvents(20, new Date(NOW - 5 * HOUR).toISOString())
    const t = setup(events.slice(0, 10))
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const more = setup(events)
    more.cache.records.set('claude', structuredClone(t.cache.records.get('claude')!))
    await syncHistory(more.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:00:00.000Z', wantFromMs: null })
    expect(more.gateway.queries[0]).toEqual({ after: expect.stringMatching(/_10$/), limit: 50 })
    expectI1(more.cache.records.get('claude'), more.server)
    expect(more.cache.records.get('claude')?.samples).toHaveLength(20)
  })
  it('When the snapshot runAt equals the last synced one Then no request is made (생략 규칙)', async () => {
    const t = setup(syntheticEvents(5, new Date(NOW - 3 * HOUR).toISOString()))
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:45:00.000Z', wantFromMs: null })
    const calls = t.gateway.queries.length
    const again = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:45:00.000Z', wantFromMs: null })
    expect(again).toMatchObject({ ok: true, skipped: true })
    expect(t.gateway.queries.length).toBe(calls)
    expect(t.cache.records.get('claude')?.syncedThroughRunAt).toBe('2026-11-14T11:45:00.000Z')
  })
  it('When there is no snapshot Then it syncs at most once per 15 minutes', async () => {
    const t = setup(syntheticEvents(5, new Date(NOW - 3 * HOUR).toISOString()))
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const calls = t.gateway.queries.length
    t.setNow(NOW + 10 * 60_000)
    expect(await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })).toMatchObject({ ok: true, skipped: true })
    t.setNow(NOW + 16 * 60_000)
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(t.gateway.queries.length).toBeGreaterThan(calls)
  })
})

describe('Given failures at any point (I1·I2)', () => {
  it('When the first page fails Then no record exists (coveredFrom is not written when the request is sent)', async () => {
    const t = setup(syntheticEvents(30, new Date(NOW - 8 * HOUR).toISOString()))
    t.gateway.failAt.add(1)
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(outcome).toMatchObject({ ok: false, reason: 'gateway' })
    expect(t.cache.records.has('claude')).toBe(false)
  })
  it.each([1, 2, 3, 4])('When call #%i fails mid-sync Then the record still equals the server interval, and a retry completes it', async (failCall) => {
    const t = setup(syntheticEvents(160, new Date(NOW - 40 * HOUR).toISOString(), 900_000))
    t.gateway.failAt.add(failCall)
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expectI1(t.cache.records.get('claude'), t.server)
    t.gateway.failAt.clear()
    t.setNow(NOW + 20 * 60_000)
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const record = t.cache.records.get('claude')!
    expectI1(record, t.server)
    expect(record.cursor).toBe(`${t.server.events.at(-1)!.runAt}_${t.server.events.at(-1)!.id}`)
  })
  it('When another tab advances the record between read and write Then the commit is rejected, the sync restarts once and I1 holds', async () => {
    const events = syntheticEvents(60, new Date(NOW - 20 * HOUR).toISOString())
    const t = setup(events)
    let interleaved = false
    t.cache.interleave = (provider) => {
      if (interleaved) return
      interleaved = true
      // 다른 탭이 같은 첫 쪽을 먼저 저장했다
      const other = applyForward(null, null, t.server.page({ from: new Date(NOW - DAY).toISOString(), limit: 50, anchor: true }), { provider, now: NOW_ISO, initialFrom: new Date(NOW - DAY).toISOString() })!
      t.cache.records.set(provider, other)
    }
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(outcome.ok).toBe(true)
    expectI1(t.cache.records.get('claude'), t.server)
    expect(t.cache.records.get('claude')?.samples).toHaveLength(60)
  })
})

describe('Given the backfill (백필)', () => {
  const events = () => syntheticEvents(96 * 4, new Date(NOW - 4 * DAY).toISOString(), 900_000)
  it('When the wanted start is before coveredFrom Then it fetches one-day chunks (from/until/anchor) and moves coveredFrom back per chunk', async () => {
    const t = setup(events())
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const before = t.cache.records.get('claude')!.coveredFrom!
    const progress: [number, number][] = []
    await syncHistory({ ...t.deps(), onProgress: (done, total) => progress.push([done, total]) }, { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 3 * DAY })
    const record = t.cache.records.get('claude')!
    expect(Date.parse(record.coveredFrom!)).toBeLessThanOrEqual(NOW - 3 * DAY)
    expect(record.coveredFrom! < before).toBe(true)
    const chunkQuery = t.gateway.queries.find((query) => query.until !== undefined)!
    expect(chunkQuery).toMatchObject({ until: before, anchor: true, limit: 50 })
    expect(progress.at(-1)?.[0]).toBe(progress.at(-1)?.[1])
    expectI1(record, t.server)
  })
  it('When a chunk fails midway Then that chunk is not applied but earlier chunks stay', async () => {
    const t = setup(events())
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const start = t.gateway.queries.length
    // 2번째 조각의 첫 요청을 실패시킨다(조각당 최대 2쪽: 96행/일)
    t.gateway.failAt.add(start + 3)
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 3 * DAY })
    expect(outcome.ok).toBe(false)
    const record = t.cache.records.get('claude')!
    expectI1(record, t.server)
    expect(Date.parse(record.coveredFrom!)).toBeGreaterThan(NOW - 3 * DAY)
  })
  it('When the wanted start is already covered Then no backfill request is made', async () => {
    const t = setup(events())
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:45:00.000Z', wantFromMs: NOW - 2 * HOUR })
    const calls = t.gateway.queries.length
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:45:00.000Z', wantFromMs: NOW - 2 * HOUR })
    expect(t.gateway.queries.length).toBe(calls)
  })
})

describe('Given budget, storage and version guards', () => {
  it('When one sync exceeds its request budget Then it stops with reason budget and keeps what was committed', async () => {
    const t = setup(syntheticEvents(400, new Date(NOW - 20 * HOUR).toISOString(), 60_000))
    const outcome = await syncHistory({ ...t.deps(), budget: createHistoryBudget({ now: () => NOW, perSync: 2 }) }, { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(outcome).toMatchObject({ ok: false, reason: 'budget' })
    expect(t.gateway.queries).toHaveLength(2)
    expectI1(t.cache.records.get('claude'), t.server)
  })
  it('When a provider exceeds 120 requests in 15 minutes Then further syncs are refused until the window passes', () => {
    let now = NOW
    const budget = createHistoryBudget({ now: () => now, perSync: 1000, perWindow: 3 })
    const first = budget.begin('claude')
    expect([first(), first(), first(), first()]).toEqual([true, true, true, false])
    expect(budget.begin('claude')()).toBe(false)
    now += 16 * 60_000
    expect(budget.begin('claude')()).toBe(true)
  })
  it('When the cache is full (quota) Then the sync keeps working from memory and reports persisted false', async () => {
    const t = setup(syntheticEvents(10, new Date(NOW - 3 * HOUR).toISOString()))
    t.cache.failUpdate = 'quota'
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(outcome).toMatchObject({ ok: true, persisted: false })
    expect(t.memory.get('claude')?.samples).toHaveLength(10)
    expect(t.cache.records.has('claude')).toBe(false)
  })
  it('When the server reports another scanVersion Then it stops, does not call again and leaves the record untouched (I6)', async () => {
    const events = syntheticEvents(10, new Date(NOW - 3 * HOUR).toISOString())
    const t = setup(events)
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    const snapshot = structuredClone(t.cache.records.get('claude'))
    const calls = t.gateway.queries.length
    t.gateway.mismatchAt.add(calls + 1)
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:59:00.000Z', wantFromMs: null })
    expect(outcome).toMatchObject({ ok: false, reason: 'version_mismatch' })
    expect(t.gateway.queries.length).toBe(calls + 1)
    expect(t.cache.records.get('claude')).toEqual(snapshot)
  })
  it('When the stored record has another scanVersion or is stale (30 days) Then it is discarded and the sync starts over', async () => {
    const old = { ...createRecord('claude', NOW_ISO), scanVersion: 999 }
    const t = setup(syntheticEvents(5, new Date(NOW - 2 * HOUR).toISOString()), [old])
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(t.cache.records.get('claude')?.scanVersion).not.toBe(999)
    expect(t.gateway.queries[0]).toMatchObject({ anchor: true })

    const stale = { ...createRecord('claude', NOW_ISO), coveredFrom: '2026-09-01T00:00:00.000Z', cursor: '2026-09-02T00:00:00.000Z_5' }
    const u = setup(syntheticEvents(5, new Date(NOW - 2 * HOUR).toISOString()), [stale])
    await syncHistory(u.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(u.gateway.queries[0]).toMatchObject({ from: new Date(NOW - DAY).toISOString(), anchor: true })
  })
})

describe('Given the G0-B confirmed parameters (쪽 50·상한 100·병렬도 1)', () => {
  it('Then the page size is 50 and the server limit cap is 100', async () => {
    const contract = await import('../../../../shared/usage-history-contract')
    expect(contract.USAGE_HISTORY_PAGE_LIMIT).toBe(50)
    expect(contract.USAGE_HISTORY_LIMIT_MAX).toBe(100)
  })
  it('Then requests never overlap during a long backfill (병렬도 1) and every request uses limit 50', async () => {
    const t = setup(syntheticEvents(96 * 4, new Date(NOW - 4 * DAY).toISOString(), 900_000))
    let concurrent = 0
    let max = 0
    t.gateway.onBeforeFetch = async () => {
      concurrent += 1
      max = Math.max(max, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 1))
      concurrent -= 1
    }
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 3 * DAY })
    expect(max).toBe(1)
    expect(t.gateway.queries.length).toBeGreaterThan(3)
    expect(t.gateway.queries.every((query) => query.limit === 50)).toBe(true)
  })
})

describe('Given a Quota error with an existing record (B3: 레코드 유실 방지)', () => {
  it('When the update fails with quota Then the existing record is moved to memory BEFORE the cache is cleared, and the sync keeps going from memory', async () => {
    const events = syntheticEvents(30, new Date(NOW - 8 * HOUR).toISOString(), 900_000)
    const t = setup(events.slice(0, 12))
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    expect(t.cache.records.get('claude')?.samples).toHaveLength(12)
    // 서버에 새 이벤트가 생겼고, 이제 저장소가 가득 찼다
    const grown = setup(events)
    grown.cache.records.set('claude', structuredClone(t.cache.records.get('claude')!))
    grown.cache.failUpdate = 'quota'
    const removed: string[] = []
    const originalRemove = grown.cache.remove
    grown.cache.remove = async (provider) => { removed.push(`remove:${grown.memory.has(provider) ? 'memory-ready' : 'memory-EMPTY'}`); await originalRemove(provider) }
    const outcome = await syncHistory(grown.deps(), { provider: 'claude', snapshotRunAt: '2026-11-14T11:59:00.000Z', wantFromMs: null })
    expect(outcome).toMatchObject({ ok: true, persisted: false })
    // 옛 표본 12개 + 새 표본이 모두 메모리에 있고, 캐시 삭제는 메모리로 옮긴 뒤에 일어났다
    expect(grown.memory.get('claude')?.samples).toHaveLength(30)
    expectI1(grown.memory.get('claude'), grown.server)
    expect(removed).toEqual(['remove:memory-ready'])
    expect(grown.cache.records.has('claude')).toBe(false)
  })
  it('When quota hits during a multi-page forward sync Then later pages and a following backfill still work from memory', async () => {
    const events = syntheticEvents(160, new Date(NOW - 40 * HOUR).toISOString(), 900_000)
    const t = setup(events)
    await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: null })
    t.cache.failUpdate = 'quota'
    t.setNow(NOW + 20 * 60_000)
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 2 * DAY })
    expect(outcome.ok).toBe(true)
    const record = t.memory.get('claude')!
    expect(Date.parse(record.coveredFrom!)).toBeLessThanOrEqual(NOW - 2 * DAY)
    expectI1(record, t.server)
  })
})

describe('Given the retention bounds (B4: 백필 종료 조건)', () => {
  it('When the wanted start is older than the 31-day retention Then the backfill stops at the bound instead of spending the request budget', async () => {
    const t = setup(syntheticEvents(40 * 24, new Date(NOW - 40 * DAY).toISOString(), HOUR))
    const outcome = await syncHistory({ ...t.deps(), pageLimit: 100 }, { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 40 * DAY })
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.backfillComplete).toBe(true)
    expect(t.gateway.queries.length).toBeLessThan(80)
    // 보존 경계(31일)보다 더 과거로는 가지 않는다
    expect(Date.parse(outcome.record.coveredFrom!)).toBeGreaterThanOrEqual(NOW - 31 * DAY - 1)
    expectI1(outcome.record, t.server)
  })
  it('When the record reaches the 4,000-sample cap Then the backfill stops (completed) and does not loop until the budget is gone', async () => {
    const t = setup(syntheticEvents(4600, new Date(NOW - 16 * DAY).toISOString(), 300_000))
    const outcome = await syncHistory({ ...t.deps(), pageLimit: 100 }, { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 30 * DAY })
    expect(outcome).toMatchObject({ ok: true })
    if (!outcome.ok) throw new Error('unreachable')
    expect(outcome.record.samples.length).toBeLessThanOrEqual(4000)
    expect(outcome.backfillComplete).toBe(true)
    expect(t.gateway.queries.length).toBeLessThan(80)
  })
  it('When the backfill reaches the wanted start normally Then backfillComplete is false-or-absent semantics stay unchanged (regression)', async () => {
    const t = setup(syntheticEvents(96 * 4, new Date(NOW - 4 * DAY).toISOString(), 900_000))
    const outcome = await syncHistory(t.deps(), { provider: 'claude', snapshotRunAt: null, wantFromMs: NOW - 3 * DAY })
    expect(outcome.ok).toBe(true)
    expect(Date.parse((outcome as { record: { coveredFrom: string } }).record.coveredFrom)).toBeLessThanOrEqual(NOW - 3 * DAY)
  })
})

