import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { D1HistoryStore } from '../../../../worker/infra/usage/d1-history-store'
import { D1SnapshotStore } from '../../../../worker/infra/usage/d1-snapshot-store'

const migration = readFileSync(fileURLToPath(new URL('../../../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const envelope = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  schema: 1,
  provider: 'codex',
  status: 'ok',
  called: true,
  runAt: '2026-11-16T00:00:00.000Z',
  fetchedAt: '2026-11-16T00:00:00.000Z',
  intervalSec: 900,
  rawText: null,
  rawRedacted: [],
  ...overrides,
})

describe('Given the D1 schema inside actual workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>
  beforeAll(async () => {
    mf = new Miniflare({
      workers: [{
        config: {
          name: 'd1-a-schema-test',
          compatibilityDate: '2026-11-11',
          env: { DB: { type: 'd1', id: 'd1-a-schema-test' } },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: 'export default { fetch() { return new Response("ok") } }' } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    db = await mf.getD1Database('DB')
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map((sql) => sql.trim()).filter(Boolean)) await db.prepare(statement).run()
  }, 30000)
  afterAll(async () => { await mf.dispose() })

  it('When 64-bit ids are inserted with CAST Then they round-trip as normalized decimal strings', async () => {
    for (const [id, runAt] of [['9007199254740992', 1000], ['9007199254740993', 1001], ['9223372036854775807', 1002]] as const) {
      await db.prepare('INSERT INTO usage_event (id, provider, run_at, status, envelope) VALUES (CAST(? AS INTEGER), ?, ?, ?, ?)')
        .bind(id, 'codex', runAt, 'ok', envelope()).run()
    }
    const rows = await db.prepare('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY id ASC').all<{ id: string }>()
    expect(rows.results.map((row: { id: string }) => row.id)).toEqual(['9007199254740992', '9007199254740993', '9223372036854775807'])
    const store = new D1HistoryStore(db)
    const history = await store.readRows('codex', { limit: 10 })
    expect(history).toMatchObject({ ok: true })
    if (!history.ok) throw new Error('unreachable')
    expect(history.value.map(row => row.id)).toEqual(['9007199254740992', '9007199254740993', '9223372036854775807'])
    expect(history.value[0]).toMatchObject({ runAt: '1970-01-01T00:00:01.000Z', fetchedAt: '2026-11-16T00:00:00.000Z', intervalSec: '900' })
    const summary = await store.readSummary(['codex', 'claude'])
    expect(summary).toMatchObject({ ok: true })
    if (!summary.ok) throw new Error('unreachable')
    expect(summary.value).toEqual([
      { provider: 'codex', okCount: 1, firstOkAt: '1970-01-01T00:00:01.000Z', lastOkAt: '1970-01-01T00:00:01.002Z' },
      { provider: 'claude', okCount: 0, firstOkAt: null, lastOkAt: null },
    ])
    const anchor = await store.readAnchorRow('codex', '1970-01-01T00:00:01.002Z')
    expect(anchor).toMatchObject({ ok: true })
    if (!anchor.ok) throw new Error('unreachable')
    expect(anchor.value?.id).toBe('9007199254740993')
  })

  it('When a cursor uses the large id Then the next page uses CAST(? AS INTEGER), not a JS number', async () => {
    const store = new D1HistoryStore(db)
    const page = await store.readRows('codex', { limit: 10, after: '1970-01-01T00:00:01.001Z_9007199254740993' })
    expect(page).toMatchObject({ ok: true })
    if (!page.ok) throw new Error('unreachable')
    expect(page.value.map(row => row.id)).toEqual(['9223372036854775807'])
  })

  it('When the snapshot store reads Then the envelope text comes back unchanged', async () => {
    await db.prepare('INSERT INTO usage_snapshot (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('codex', envelope({ provider: 'codex' }), 'ok', 1000, 1000, 'sha', '0.6.20', 1000).run()
    const store = new D1SnapshotStore(db)
    await expect(store.read('codex')).resolves.toEqual({ ok: true, value: envelope({ provider: 'codex' }) })
  })

  it('When malformed JSON, non-integer timing or invalid boundary keys are inserted Then D1 rejects them', async () => {
    await expect(db.prepare('INSERT INTO usage_event (provider, run_at, status, envelope) VALUES (?, ?, ?, ?)')
      .bind('codex', 1, 'ok', '[]').run()).rejects.toThrow()
    await expect(db.prepare('INSERT INTO usage_event (provider, run_at, status, envelope) VALUES (?, ?, ?, ?)')
      .bind('codex', 'not-an-integer', 'ok', envelope()).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO usage_event (provider, run_at, status, envelope, operation_id) VALUES (?, ?, ?, ?, '')")
      .bind('codex', 2, 'ok', envelope()).run()).rejects.toThrow()
    await db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'flat', 900, NULL, 1000, 'ok', ?)")
      .bind(envelope()).run()
    await expect(db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'flat', 900, NULL, 1001, 'ok', ?)")
      .bind(envelope()).run()).rejects.toThrow()
    await db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'point', NULL, '1', 1000, 'token_expired', ?)")
      .bind(envelope({ status: 'token_expired', values: null })).run()
    await expect(db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'point', NULL, '1', 1001, 'token_expired', ?)")
      .bind(envelope({ status: 'token_expired', values: null })).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'flat', NULL, '2', 1000, 'ok', ?)")
      .bind(envelope()).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO usage_bucket_boundary (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope) VALUES ('codex', 2, 0, 'point', 900, NULL, 1000, 'ok', ?)")
      .bind(envelope()).run()).rejects.toThrow()
    await expect(db.prepare("INSERT INTO usage_bucket_checkpoint (provider, scan_version, data_generation, last_processed_id) VALUES ('codex', 2, 0, '01')").run()).rejects.toThrow()
    await db.prepare("INSERT INTO usage_bucket_checkpoint (provider, scan_version, data_generation, last_processed_id) VALUES ('codex', 2, 0, '0')").run()
    await expect(db.prepare("INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms) VALUES (NULL, 'codex', 1, 'hash', 1)").run()).rejects.toThrow()
    await db.prepare("INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms) VALUES ('op', 'codex', 1, 'hash', 1)").run()
    await expect(db.prepare("INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms) VALUES ('op2', 'codex', 1, 'hash', 1)").run()).rejects.toThrow()
  })
})
