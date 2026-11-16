import { describe, expect, it } from 'vitest'
import { canonicalMigrationJson, migrationRowSha256, reverseMigrateToPostgres } from '../../../../worker/infra/usage/pg-rollback'
import { migrationRowTuple } from '../../../../shared/d1-canonical.ts'
import { createHash } from 'node:crypto'
import { createTestDb } from '../../../fakes/pglite-db'

const RUN_AT = Date.parse('2026-11-16T00:00:00.000Z')
const RAW_SHA = 'a'.repeat(64)
const envelope = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  schema: 1,
  provider: 'codex',
  status: 'ok',
  called: true,
  runAt: '2026-11-16T00:00:00.000Z',
  fetchedAt: '2026-11-16T00:00:00.000Z',
  httpStatus: 200,
  retryAt: null,
  tokenExpiresAt: null,
  kvTokenExpiresAt: null,
  intervalSec: 900,
  rawText: null,
  rawOmitted: null,
  rawRedacted: [],
  collectorVersion: '0.6.20',
  ...overrides,
})

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  provider: 'codex',
  runAtMs: RUN_AT,
  status: 'ok',
  rawSha256: RAW_SHA,
  envelope: envelope(),
  ...overrides,
})

describe('Given the PG reverse-migration SQL tool', () => {
  it('When explicit ids are imported Then OVERRIDING SYSTEM VALUE keeps them and the next identity is max+1', async () => {
    const db = await createTestDb()
    try {
      const result = await reverseMigrateToPostgres(db.client, {
        events: [event('9007199254740993'), event('9007199254740994')],
        snapshots: [],
      })
      expect(result).toEqual({ events: 2, snapshots: 0, skipped: 0 })
      const rows = await db.client.query<{ id: string }>('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY usage_event.id')
      expect(rows.rows.map(row => row.id)).toEqual(['9007199254740993', '9007199254740994'])
      const next = await db.client.query<{ id: string }>(
        "INSERT INTO usage_event (provider, run_at, status, envelope) VALUES ('codex', now(), 'ok', '{}'::jsonb) RETURNING CAST(id AS TEXT) AS id",
      )
      expect(next.rows[0]!.id).toBe('9007199254740995')
    } finally {
      await db.close()
    }
  })

  it('When a row hash is already present Then the same row is skipped and a different hash aborts the transaction', async () => {
    const db = await createTestDb()
    try {
      await reverseMigrateToPostgres(db.client, { events: [event('1')], snapshots: [] })
      const skipped = await reverseMigrateToPostgres(db.client, { events: [event('1')], snapshots: [] })
      expect(skipped).toEqual({ events: 0, snapshots: 0, skipped: 1 })
      await expect(reverseMigrateToPostgres(db.client, {
        events: [event('1', { envelope: envelope({ intervalSec: 180 }) })],
        snapshots: [],
      })).rejects.toThrow(/hash/i)
      const rows = await db.client.query<{ count: string }>('SELECT count(*)::text AS count FROM usage_event')
      expect(rows.rows[0]!.count).toBe('1')
    } finally {
      await db.close()
    }
  })

  it('When a later row mismatches Then earlier inserts from that transaction are rolled back too', async () => {
    const db = await createTestDb()
    try {
      await reverseMigrateToPostgres(db.client, { events: [event('1')], snapshots: [] })
      await expect(reverseMigrateToPostgres(db.client, {
        events: [event('2'), event('1', { envelope: envelope({ intervalSec: 180 }) })],
        snapshots: [],
      })).rejects.toThrow(/hash/i)
      const rows = await db.client.query<{ id: string }>('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY usage_event.id')
      expect(rows.rows.map(row => row.id)).toEqual(['1'])
    } finally {
      await db.close()
    }
  })

  it('When a snapshot is imported Then its canonical hash is checked and it is copied without D1 write-only columns', async () => {
    const db = await createTestDb()
    try {
      const snapshot = {
        provider: 'codex',
        runAtMs: RUN_AT,
        fetchedAtMs: RUN_AT,
        status: 'ok',
        rawSha256: RAW_SHA,
        envelope: envelope(),
        collectorVersion: '0.6.20',
        updatedAtMs: RUN_AT,
      }
      const result = await reverseMigrateToPostgres(db.client, { events: [], snapshots: [snapshot] })
      expect(result).toEqual({ events: 0, snapshots: 1, skipped: 0 })
      const rows = await db.client.query<{ provider: string }>('SELECT provider FROM usage_snapshot')
      expect(rows.rows).toEqual([{ provider: 'codex' }])
    } finally {
      await db.close()
    }
  })
})

describe('Given PG timestamps with sub-millisecond precision', () => {
  it('When an existing event has .123900 seconds Then the existing row is matched at 123ms, not rounded to 124', async () => {
    const db = await createTestDb()
    try {
      const ms = Date.parse('2026-11-16T03:00:00.123Z')
      const env = envelope({ runAt: new Date(ms).toISOString(), fetchedAt: new Date(ms).toISOString() })
      await db.client.query(
        `INSERT INTO usage_event (id, provider, run_at, status, raw_sha256, envelope) OVERRIDING SYSTEM VALUE VALUES (1, 'codex', TIMESTAMPTZ '2026-11-16T03:00:00.123900Z', 'ok', '${RAW_SHA}', $1::jsonb)`,
        [env],
      )
      const result = await reverseMigrateToPostgres(db.client, { events: [event('1', { runAtMs: ms, envelope: env })], snapshots: [] })
      expect(result).toEqual({ events: 0, snapshots: 0, skipped: 1 })
    } finally {
      await db.close()
    }
  })

  it('When a newer D1 snapshot replaces an older PG snapshot Then the UPSERT commits the latest snapshot in the same transaction', async () => {
    const db = await createTestDb()
    try {
      const oldMs = Date.parse('2026-11-16T02:45:00.123Z')
      const newMs = Date.parse('2026-11-16T03:00:00.123Z')
      const oldEnvelope = envelope({ runAt: new Date(oldMs).toISOString(), fetchedAt: new Date(oldMs).toISOString() })
      const newEnvelope = envelope({ runAt: new Date(newMs).toISOString(), fetchedAt: new Date(newMs).toISOString() })
      await db.client.query(
        `INSERT INTO usage_snapshot (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at) VALUES ('codex', $1::jsonb, 'ok', TIMESTAMPTZ '2026-11-16T02:45:00.123Z', TIMESTAMPTZ '2026-11-16T02:45:00.123Z', '${RAW_SHA}', '0.6.19', TIMESTAMPTZ '2026-11-16T02:45:00.123Z')`,
        [oldEnvelope],
      )
      const snapshot = {
        provider: 'codex',
        runAtMs: newMs,
        fetchedAtMs: newMs,
        status: 'ok',
        rawSha256: RAW_SHA,
        envelope: newEnvelope,
        collectorVersion: '0.6.20',
        updatedAtMs: newMs,
      }
      const result = await reverseMigrateToPostgres(db.client, { events: [], snapshots: [snapshot] })
      expect(result).toEqual({ events: 0, snapshots: 1, skipped: 0 })
      const row = await db.client.query<{ runAt: string; collectorVersion: string }>("SELECT envelope->>'runAt' AS \"runAt\", collector_version AS \"collectorVersion\" FROM usage_snapshot WHERE provider = 'codex'")
      expect(row.rows[0]).toEqual({ runAt: new Date(newMs).toISOString(), collectorVersion: '0.6.20' })
    } finally {
      await db.close()
    }
  })
})

  it('When event columns or envelope provider/status/runAt disagree Then no row is written', async () => {
    const db = await createTestDb()
    try {
      for (const envelopeJson of [
        envelope({ provider: 'claude' }),
        envelope({ status: 'rate_limited' }),
        envelope({ runAt: '2026-11-16T00:00:01.000Z' }),
      ]) {
        await expect(reverseMigrateToPostgres(db.client, {
          events: [event('1', { envelope: envelopeJson })],
          snapshots: [],
        })).rejects.toThrow(/invalid migration row|migration_column_mismatch/)
      }
      const rows = await db.client.query<{ count: string }>('SELECT count(*)::text AS count FROM usage_event')
      expect(rows.rows[0]!.count).toBe('0')
    } finally {
      await db.close()
    }
  })

describe('Given canonical migration hashes', () => {
  it('When object key order differs Then the canonical hash is equal', () => {
    const a = canonicalMigrationJson({ b: 1, a: { z: 2, y: 3 } })
    const b = canonicalMigrationJson({ a: { y: 3, z: 2 }, b: 1 })
    expect(a).toBe(b)
    const reordered = event('1', { envelope: JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(envelope())).reverse())) })
    expect(migrationRowSha256(event('1'))).toBe(migrationRowSha256(reordered))
    expect(migrationRowSha256(event('1'))).not.toBe(migrationRowSha256(event('2')))
  })
  it('When object keys are integer-shaped Then canonical hash follows lexicographic shared canonical order', () => {
    const withNumericKeys = event('1', { envelope: envelope({ extension: { '2': 2, '10': 10 } }) })
    const tuple = migrationRowTuple({
      id: withNumericKeys.id,
      provider: withNumericKeys.provider,
      runAt: new Date(withNumericKeys.runAtMs).toISOString(),
      status: withNumericKeys.status,
      rawSha256: withNumericKeys.rawSha256,
      envelopeJson: withNumericKeys.envelope,
    })
    expect(tuple.ok).toBe(true)
    if (!tuple.ok) throw new Error('unreachable')
    expect(canonicalMigrationJson({ extension: { '2': 2, '10': 10 } })).toBe('{"extension":{"10":10,"2":2}}')
    expect(migrationRowSha256(withNumericKeys)).toBe(createHash('sha256').update(tuple.value, 'utf8').digest('hex'))
  })
})

describe('Given PostgreSQL sequence semantics', () => {
  it('When setval is rolled back in a transaction Then the sequence stays advanced (setval is non-transactional)', async () => {
    const db = await createTestDb()
    try {
      await db.client.query('BEGIN')
      await db.client.query("SELECT setval('usage_event_id_seq', 9007199254740995, true)")
      await db.client.query('ROLLBACK')
      const next = await db.client.query<{ id: string }>("SELECT nextval('usage_event_id_seq')::text AS id")
      expect(next.rows[0]!.id).toBe('9007199254740996')
    } finally {
      await db.close()
    }
  })
  it('When the sequence is already ahead of the imported max Then the tool never lowers it', async () => {
    const db = await createTestDb()
    try {
      await db.client.query("SELECT setval('usage_event_id_seq', 9007199254740996, true)")
      await reverseMigrateToPostgres(db.client, { events: [event('9007199254740993')], snapshots: [] })
      const next = await db.client.query<{ id: string }>("SELECT nextval('usage_event_id_seq')::text AS id")
      expect(next.rows[0]!.id).toBe('9007199254740997')
    } finally {
      await db.close()
    }
  })
})
