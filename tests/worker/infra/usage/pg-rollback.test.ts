import { describe, expect, it } from 'vitest'
import { canonicalMigrationJson, migrationRowSha256, reverseMigrateToPostgres } from '../../../../worker/infra/usage/pg-rollback'
import { createTestDb } from '../../../fakes/pglite-db'

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

const event = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  provider: 'codex',
  runAtMs: 1_760_000_000_000,
  status: 'ok',
  rawSha256: 'raw-sha',
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
      const rows = await db.client.query<{ id: string }>('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY id')
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
        events: [event('1', { envelope: envelope({ status: 'limit', provider: 'codex' }) })],
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
        events: [event('2'), event('1', { envelope: envelope({ status: 'limit' }) })],
        snapshots: [],
      })).rejects.toThrow(/hash/i)
      const rows = await db.client.query<{ id: string }>('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY id')
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
        runAtMs: 1_760_000_000_000,
        fetchedAtMs: 1_760_000_000_000,
        status: 'ok',
        rawSha256: 'raw-sha',
        envelope: envelope(),
        collectorVersion: '0.6.20',
        updatedAtMs: 1_760_000_000_000,
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

describe('Given canonical migration hashes', () => {
  it('When object key order differs Then the canonical hash is equal', () => {
    const a = canonicalMigrationJson({ b: 1, a: { z: 2, y: 3 } })
    const b = canonicalMigrationJson({ a: { y: 3, z: 2 }, b: 1 })
    expect(a).toBe(b)
    const reordered = event('1', {
      envelope: JSON.stringify({ rawRedacted: [], rawText: null, intervalSec: 900, fetchedAt: '2026-11-16T00:00:00.000Z', runAt: '2026-11-16T00:00:00.000Z', called: true, status: 'ok', provider: 'codex', schema: 1 }),
    })
    expect(migrationRowSha256(event('1'))).toBe(migrationRowSha256(reordered))
    expect(migrationRowSha256(event('1'))).not.toBe(migrationRowSha256(event('2')))
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
