import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../../../fakes/pglite-db'
import { usageEvent } from '../../../../shared/db/schema'
import type { UsageEnvelope, UsageStatus } from '../../../../shared/usage-contract'
import { PostgresBucketStore } from '../../../../worker/infra/usage/postgres-bucket-store'
import { PostgresHistoryStore } from '../../../../worker/infra/usage/postgres-history-store'
import type { SnapshotDatabase } from '../../../../worker/infra/usage/postgres-snapshot-store'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'

const T0 = Date.parse('2026-11-16T00:00:00.000Z')
const DAY = 86_400_000

let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

const envelope = (atMs: number, overrides: Record<string, unknown> = {}): UsageEnvelope => ({
  schema: 1,
  provider: 'claude',
  status: 'ok',
  called: true,
  runAt: new Date(atMs).toISOString(),
  fetchedAt: new Date(atMs).toISOString(),
  httpStatus: 200,
  retryAt: null,
  tokenExpiresAt: null,
  kvTokenExpiresAt: null,
  intervalSec: 180,
  collectorVersion: '0.6.20',
  rawText: JSON.stringify({ five_hour: { utilization: 10 } }),
  rawOmitted: null,
  rawRedacted: [],
  ...overrides,
} as UsageEnvelope)

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db']
async function insert(db: TestDb, rows: Array<{ atMs: number; status?: UsageStatus; raw?: string; intervalSec?: number; resetsAt?: string | null; provider?: string }>): Promise<void> {
  for (const row of rows) {
    const rawText = row.raw ?? JSON.stringify({ five_hour: { utilization: 10, resets_at: row.resetsAt ?? null } })
    await db.insert(usageEvent).values({
      provider: row.provider ?? 'claude',
      status: row.status ?? 'ok',
      runAt: new Date(row.atMs),
      envelope: envelope(row.atMs, { status: row.status ?? 'ok', rawText, intervalSec: row.intervalSec ?? 180 }),
    })
  }
}

const query = (from: string, until: string) => ({ from, until, bucketSec: 900 as const })
const iso = (ms: number): string => new Date(ms).toISOString()

describe('Given the PostgreSQL 30-day fallback', () => {
  it('When flat success samples share a bucket Then only the last representative is returned', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [1, 2, 3].map(index => ({ atMs: T0 + index * 60_000 })))
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase))
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value).toMatchObject({ provider: 'claude', scanVersion: USAGE_HISTORY_SCAN_VERSION, bucketSec: 900, complete: true, anchor: null })
    expect(page.value.samples).toHaveLength(1)
    expect(page.value.samples[0]).toMatchObject({ runAt: iso(T0 + 180_000), values: [{ id: 'five_hour', usedPercent: 10 }] })
  })

  it('When a failure sits between successes Then the failure point is kept and the next success is the flat', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [
      { atMs: T0 + 60_000 },
      { atMs: T0 + 120_000, status: 'rate_limited' },
      { atMs: T0 + 180_000 },
      { atMs: T0 + 240_000 },
    ])
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase))
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => [item.runAt, item.values === null ? null : item.values[0]?.usedPercent])).toEqual([
      [iso(T0 + 120_000), null],
      [iso(T0 + 240_000), 10],
    ])
  })

  it('When the previous event is before from and the gap is too long Then the first in-range sample is a point and the raw anchor is separate', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [{ atMs: T0 - 600_000 }, { atMs: T0 + 60_000 }])
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase))
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => item.runAt)).toEqual([iso(T0 + 60_000)])
    expect(page.value.samples[0]?.values).not.toBeNull()
    expect(page.value.anchor?.runAt).toBe(iso(T0 - 600_000))
  })

  it('When the reset time or series set changes Then each change is a point', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [
      { atMs: T0 + 60_000, resetsAt: null },
      { atMs: T0 + 120_000, resetsAt: '2026-11-16T05:00:00.000Z' },
      { atMs: T0 + 180_000, raw: JSON.stringify({ five_hour: { utilization: 10, resets_at: '2026-11-16T05:00:00.000Z' }, seven_day: { utilization: 20 } }) },
      { atMs: T0 + 240_000, raw: JSON.stringify({ five_hour: { utilization: 10, resets_at: '2026-11-16T05:00:00.000Z' }, seven_day: { utilization: 20 } }) },
    ])
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase))
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => item.runAt)).toEqual([
      iso(T0 + 120_000),
      iso(T0 + 180_000),
      iso(T0 + 240_000),
    ])
  })

  it('When from cuts through a flat bucket Then the pre-from flat is not emitted but remains the raw anchor', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [{ atMs: T0 + 60_000 }])
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase))
    const page = await store.readBuckets('claude', query(iso(T0 + 100_000), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples).toEqual([])
    expect(page.value.anchor?.runAt).toBe(iso(T0 + 60_000))
  })

  it('When the response exceeds maxPoints Then the newest slice survives and complete is false', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [
      { atMs: T0 + 60_000, status: 'network_error' },
      { atMs: T0 + 120_000, status: 'network_error' },
      { atMs: T0 + 180_000, status: 'network_error' },
    ])
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase), { maxPoints: 2 })
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.complete).toBe(false)
    expect(page.value.samples.map(item => item.runAt)).toEqual([iso(T0 + 120_000), iso(T0 + 180_000)])
  })

  it('When the read budget is exceeded Then complete is false without throwing', async () => {
    const t = await createTestDb()
    close = t.close
    await insert(t.db, [{ atMs: T0 + 60_000 }])
    let calls = 0
    const store = new PostgresBucketStore(new PostgresHistoryStore(t.db as SnapshotDatabase), {
      now: () => (calls++ === 0 ? 0 : 9_001),
    })
    const page = await store.readBuckets('claude', query(iso(T0), iso(T0 + 30 * DAY)))
    expect(page).toMatchObject({ ok: true, value: { complete: false } })
  })
})
