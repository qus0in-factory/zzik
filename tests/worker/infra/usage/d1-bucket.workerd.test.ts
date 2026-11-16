import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../../../fakes/pglite-db'
import { usageEvent } from '../../../../shared/db/schema'
import { runBucketWriter } from '../../../../worker/app/usage/bucket-writer'
import { bucketStartMs } from '../../../../worker/domain/usage/bucket'
import { D1BucketStore, D1BucketWriterStore } from '../../../../worker/infra/usage/d1-bucket-store'
import type { BucketEvent } from '../../../../worker/domain/usage/bucket-store'
import { PostgresBucketStore } from '../../../../worker/infra/usage/postgres-bucket-store'
import { PostgresHistoryStore } from '../../../../worker/infra/usage/postgres-history-store'
import type { SnapshotDatabase } from '../../../../worker/infra/usage/postgres-snapshot-store'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'
import type { UsageEnvelope } from '../../../../shared/usage-contract'
import type { UsageHistorySample } from '../../../../shared/usage-history-contract'

const migration = readFileSync(fileURLToPath(new URL('../../../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const T0 = Date.parse('2026-11-16T00:00:00.000Z')
const DAY = 86_400_000

const envelope = (provider: 'claude', overrides: Record<string, unknown> = {}): string => JSON.stringify({
  schema: 1,
  provider,
  status: 'ok',
  called: true,
  runAt: '2026-11-16T00:00:00.000Z',
  fetchedAt: '2026-11-16T00:00:00.000Z',
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
})

const sample = (id: string, atMs: number, usedPercent = 10, overrides: Partial<UsageHistorySample> = {}): UsageHistorySample => ({
  id,
  runAt: new Date(atMs).toISOString(),
  status: 'ok',
  fetchedAt: new Date(atMs).toISOString(),
  intervalSec: 180,
  values: [{ id: 'five_hour', usedPercent, resetsAt: null, cycleSeconds: null }],
  ...overrides,
})

const event = (id: string, atMs: number, usedPercent = 10, overrides: Partial<UsageHistorySample> = {}): BucketEvent => ({
  sample: sample(id, atMs, usedPercent, overrides),
  envelope: envelope('claude', { fetchedAt: new Date(atMs).toISOString(), intervalSec: 180, rawText: JSON.stringify({ five_hour: { utilization: usedPercent } }) }),
})

async function applyMigration(db: Awaited<ReturnType<Miniflare['getD1Database']>>): Promise<void> {
  for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
    await db.prepare(statement).run()
  }
}

describe('Given the D1 bucket writer and reader inside actual workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>
  const provider = 'claude' as const

  beforeAll(async () => {
    mf = new Miniflare({
      workers: [{
        config: {
          name: 'd1-bucket-test',
          compatibilityDate: '2026-11-11',
          env: { DB: { type: 'd1', id: 'd1-bucket-test' } },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: 'export default { fetch() { return new Response("ok") } }' } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    db = await mf.getD1Database('DB')
    await applyMigration(db)
  }, 30_000)

  afterAll(async () => { await mf.dispose() })

  beforeEach(async () => {
    for (const table of ['usage_bucket_boundary', 'usage_bucket_checkpoint', 'usage_event']) {
      await db.prepare(`DELETE FROM ${table}`).run()
    }
  })

  async function insert(events: BucketEvent[]): Promise<void> {
    for (let index = 0; index < events.length; index += 100) {
      const statements = events.slice(index, index + 100).map(item => db.prepare(
        'INSERT INTO usage_event (id, provider, run_at, status, envelope) VALUES (CAST(? AS INTEGER), ?, ?, ?, ?)',
      ).bind(item.sample.id, provider, Date.parse(item.sample.runAt), item.sample.status, item.envelope))
      await db.batch(statements)
    }
  }

  const run = (pageRows = 100) => runBucketWriter(new D1BucketWriterStore(db), {
    scanVersion: USAGE_HISTORY_SCAN_VERSION,
    dataGeneration: 0,
    nowMs: T0 + 10 * 60_000,
    providers: [provider],
    pageRows,
  })

  const read = (from: string, until: string, options: { now?: () => number } = {}) =>
    new D1BucketStore(db, { dataGeneration: 0, ...options }).readBuckets(provider, { from, until, bucketSec: 900 })

  it('When all success samples in one bucket are flat Then only one flat row exists and the checkpoint advances to the last id', async () => {
    await insert([1, 2, 3, 4, 5].map(index => event(String(index), T0 + index * 60_000)))
    await expect(run(2)).resolves.toMatchObject({ ok: true, value: { pages: 3, flats: 3, points: 0 } })
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('5')
    const boundaries = await db.prepare("SELECT row_kind AS kind, CAST(run_at_ms AS TEXT) AS runAt FROM usage_bucket_boundary WHERE provider = ? ORDER BY run_at_ms").bind(provider).all<{ kind: string; runAt: string }>()
    expect(boundaries.results).toEqual([{ kind: 'flat', runAt: String(T0 + 300_000) }])
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    expect(page).toMatchObject({ ok: true, value: { complete: true, anchor: null } })
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples).toHaveLength(1)
    expect(page.value.samples[0]).toMatchObject({ id: `flat:${T0}`, runAt: new Date(T0 + 300_000).toISOString(), values: [{ id: 'five_hour', usedPercent: 10 }] })
  })

  it('When a failure and a value change occur Then the point and the bucket flat are both stored and read back', async () => {
    await insert([
      event('1', T0 + 60_000),
      event('2', T0 + 120_000, 10, { status: 'rate_limited', values: null }),
      event('3', T0 + 180_000, 20),
      event('4', T0 + 240_000, 20),
    ])
    await run()
    const boundaries = await db.prepare("SELECT row_kind AS kind, CAST(run_at_ms AS TEXT) AS runAt, CAST(source_event_id AS TEXT) AS sourceId FROM usage_bucket_boundary WHERE provider = ? ORDER BY run_at_ms").bind(provider).all<{ kind: string; runAt: string; sourceId: string | null }>()
    expect(boundaries.results).toEqual([
      { kind: 'point', runAt: String(T0 + 120_000), sourceId: '2' },
      { kind: 'flat', runAt: String(T0 + 240_000), sourceId: null },
    ])
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => [item.id, item.runAt, item.values === null ? null : item.values[0]?.usedPercent])).toEqual([
      ['2', new Date(T0 + 120_000).toISOString(), null],
      [`flat:${T0}`, new Date(T0 + 240_000).toISOString(), 20],
    ])
  })

  it('When the page ends on a point Then the checkpoint advances to the point while the flat stays at the earlier representative', async () => {
    await insert([event('1', T0 + 60_000, 10), event('2', T0 + 120_000, 20)])
    await run()
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('2')
    const rows = await db.prepare("SELECT row_kind AS kind, CAST(run_at_ms AS TEXT) AS runAt FROM usage_bucket_boundary WHERE provider = ? ORDER BY run_at_ms").bind(provider).all<{ kind: string; runAt: string }>()
    expect(rows.results).toEqual([
      { kind: 'flat', runAt: String(T0 + 60_000) },
      { kind: 'point', runAt: String(T0 + 120_000) },
    ])
  })

  it('When retention deletes old boundary rows Then the checkpoint stays where it was', async () => {
    await insert([1, 2, 3].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    await db.prepare('DELETE FROM usage_bucket_boundary WHERE provider = ?').bind(provider).run()
    await run()
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('3')
    const boundaries = await db.prepare('SELECT count(*) AS count FROM usage_bucket_boundary WHERE provider = ?').bind(provider).all<{ count: number }>()
    expect(boundaries.results[0]?.count).toBe(0)
  })

  it('When a cron restarts after a page Then it re-reads the last event and the flat representative', async () => {
    await insert([1, 2].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    const firstCheckpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(firstCheckpoint.results[0]?.lastId).toBe('2')
    await insert([3, 4].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('4')
    const flat = await db.prepare("SELECT CAST(run_at_ms AS TEXT) AS runAt FROM usage_bucket_boundary WHERE provider = ? AND row_kind = 'flat'").bind(provider).all<{ runAt: string }>()
    expect(flat.results[0]?.runAt).toBe(String(T0 + 240_000))
  })

  it('When the checkpoint id has no event row Then it stalls without writing a boundary', async () => {
    await insert([event('1', T0 + 60_000)])
    await db.prepare("INSERT INTO usage_bucket_checkpoint (provider, scan_version, data_generation, last_processed_id) VALUES (?, ?, 0, '99')").bind(provider, USAGE_HISTORY_SCAN_VERSION).run()
    await expect(run()).resolves.toMatchObject({ ok: true, value: { pages: 0, stalled: 1 } })
    const checkpoint = await db.prepare('SELECT CAST(stalled_at_ms AS TEXT) AS stalledAt FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ stalledAt: string }>()
    expect(checkpoint.results[0]?.stalledAt).toBe(String(T0 + 10 * 60_000))
    const boundaries = await db.prepare('SELECT count(*) AS count FROM usage_bucket_boundary WHERE provider = ?').bind(provider).all<{ count: number }>()
    expect(boundaries.results[0]?.count).toBe(0)
  })

  it('When a late writer writes an older flat and checkpoint Then neither moves backwards', async () => {
    await insert([1, 2, 3].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    const writer = new D1BucketWriterStore(db)
    await writer.writePage({
      provider,
      scanVersion: USAGE_HISTORY_SCAN_VERSION,
      dataGeneration: 0,
      lastProcessedId: '2',
      points: [],
      flats: [{ bucketStartMs: T0, event: event('2', T0 + 120_000) }],
    })
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('3')
    const flat = await db.prepare("SELECT CAST(run_at_ms AS TEXT) AS runAt FROM usage_bucket_boundary WHERE provider = ? AND row_kind = 'flat'").bind(provider).all<{ runAt: string }>()
    expect(flat.results[0]?.runAt).toBe(String(T0 + 180_000))
  })

  it('When the boundary set exceeds 4,000 points Then the response keeps the newest 4,000 and reports complete false', async () => {
    const events = Array.from({ length: 4_100 }, (_, index) => event(String(index + 1), T0 + index * 60_000, 10, { status: 'network_error', values: null }))
    await insert(events)
    await expect(run(500)).resolves.toMatchObject({ ok: true })
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.complete).toBe(false)
    expect(page.value.samples).toHaveLength(4_000)
    expect(page.value.samples[0]?.id).toBe('101')
    expect(page.value.samples.at(-1)?.id).toBe('4100')
  }, 60_000)

  it('When the read budget is exceeded Then the response reports complete false', async () => {
    await insert([event('1', T0 + 60_000)])
    await run()
    let calls = 0
    const now = () => {
      const value = calls === 0 ? 0 : 9_001
      calls += 1
      return value
    }
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString(), { now })
    expect(page).toMatchObject({ ok: true, value: { complete: false } })
  })

  it('When the anchor is requested Then it comes from the raw event before from, not the boundary table', async () => {
    await insert([event('1', T0 - 60_000), event('2', T0 + 60_000)])
    await run()
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.anchor?.id).toBe('1')
    expect(page.value.samples.map(item => item.id)).toEqual([`flat:${T0}`])
  })

  it('When from cuts through a bucket Then an out-of-range flat is not emitted but remains the raw anchor', async () => {
    await insert([event('1', T0 + 60_000)])
    await run()
    const page = await read(new Date(T0 + 100_000).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples).toEqual([])
    expect(page.value.anchor?.id).toBe('1')
  })

  it('When from cuts through a bucket Then its in-range flat representative is still returned, matching PostgreSQL', async () => {
    await insert([event('1', T0 + 6 * 60_000), event('2', T0 + 10 * 60_000)])
    await run()
    const from = new Date(T0 + 5 * 60_000).toISOString()
    const until = new Date(T0 + 30 * DAY).toISOString()
    const page = await read(from, until)
    if (!page.ok) throw new Error('unreachable')
    const actual = page.value.samples.map(item => [item.runAt, item.values === null ? null : item.values[0]?.usedPercent])

    // PG fallback reads raw rows with run_at >= from; D1 must return the same representative.
    const pg = await createTestDb()
    try {
      for (const atMs of [T0 + 6 * 60_000, T0 + 10 * 60_000]) {
        await pg.db.insert(usageEvent).values({
          provider,
          status: 'ok',
          runAt: new Date(atMs),
          envelope: JSON.parse(envelope('claude', {
            fetchedAt: new Date(atMs).toISOString(),
            rawText: JSON.stringify({ five_hour: { utilization: 10 } }),
          })) as UsageEnvelope,
        })
      }
      const pgPage = await new PostgresBucketStore(new PostgresHistoryStore(pg.db as SnapshotDatabase))
        .readBuckets(provider, { from, until, bucketSec: 900 })
      if (!pgPage.ok) throw new Error('unreachable')
      expect(actual).toEqual(pgPage.value.samples.map(item => [item.runAt, item.values === null ? null : item.values[0]?.usedPercent]))
    } finally {
      await pg.close()
    }
    expect(actual).toEqual([[new Date(T0 + 10 * 60_000).toISOString(), 10]])
  })

  it('When events arrive after the checkpoint Then readBuckets folds the raw tail without moving the checkpoint', async () => {
    await insert([1, 2, 3, 4, 5].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    await insert([event('6', T0 + 6 * 60_000, 20), event('7', T0 + 7 * 60_000, 20)])
    const boundaryBefore = await db.prepare('SELECT count(*) AS count FROM usage_bucket_boundary WHERE provider = ?').bind(provider).all<{ count: number }>()
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => [item.runAt, item.values === null ? null : item.values[0]?.usedPercent])).toEqual([
      [new Date(T0 + 6 * 60_000).toISOString(), 20],
      [new Date(T0 + 7 * 60_000).toISOString(), 20],
    ])
    const checkpoint = await db.prepare('SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = ?').bind(provider).all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('5')
    const boundaryAfter = await db.prepare('SELECT count(*) AS count FROM usage_bucket_boundary WHERE provider = ?').bind(provider).all<{ count: number }>()
    expect(boundaryAfter.results[0]?.count).toBe(boundaryBefore.results[0]?.count)
  })

  it('When the raw tail reaches a new bucket Then its flat is added beside the stored boundary history', async () => {
    await insert([1, 2, 3, 4, 5].map(index => event(String(index), T0 + index * 60_000)))
    await run()
    await insert([event('6', T0 + 16 * 60_000, 30), event('7', T0 + 17 * 60_000, 30)])
    const page = await read(new Date(T0).toISOString(), new Date(T0 + 30 * DAY).toISOString())
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.samples.map(item => [item.runAt, item.values === null ? null : item.values[0]?.usedPercent])).toEqual([
      [new Date(T0 + 5 * 60_000).toISOString(), 10],
      [new Date(T0 + 16 * 60_000).toISOString(), 30],
      [new Date(T0 + 17 * 60_000).toISOString(), 30],
    ])
  })

  it('When 10,000 events at 180 seconds are folded Then the boundary count is bucketed and the local writer stays within budget', async () => {
    const events = Array.from({ length: 10_000 }, (_, index) => event(String(index + 1), T0 + index * 180_000))
    await insert(events)
    const started = Date.now()
    const result = await run(100)
    const elapsed = Date.now() - started
    expect(result).toMatchObject({ ok: true })
    const counts = await db.prepare("SELECT row_kind AS kind, count(*) AS count FROM usage_bucket_boundary WHERE provider = ? GROUP BY row_kind").bind(provider).all<{ kind: string; count: number }>()
    const byKind = Object.fromEntries(counts.results.map((row: { kind: string; count: number }) => [row.kind, row.count]))
    expect(byKind.flat).toBeGreaterThan(1_900)
    expect(byKind.flat).toBeLessThan(2_100)
    expect(byKind.point ?? 0).toBe(0)
    expect(elapsed).toBeLessThan(20_000)
    console.log(`D1_E_HIGH_DENSITY events=10000 elapsedMs=${elapsed} flats=${byKind.flat} points=${byKind.point ?? 0}`)
  }, 120_000)
})
