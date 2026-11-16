import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createCollectorD1Write, buildD1WriteBatch, validateCollectorD1Write } from '../../../../collector/domain/usage/d1-write-contract.mjs'
import { sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'
import { D1_OPERATION_ID, D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'

const create = (emitEvent = true, writeSeq = 1, operationId = D1_OPERATION_ID, envelopeJson = JSON.stringify(d1Envelope())) =>
  successValue(createCollectorD1Write({ operationId, provider: 'claude', writeSeq, envelopeJson, emitEvent }))

/** A protocol harness, not the final D1 DDL owned by z-ds. */
function database() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE usage_write_receipt(operation_id TEXT NOT NULL PRIMARY KEY,provider TEXT NOT NULL,write_seq INTEGER NOT NULL,payload_sha256 TEXT NOT NULL,created_at_ms INTEGER NOT NULL,UNIQUE(provider,write_seq));
    CREATE TABLE usage_snapshot(provider TEXT PRIMARY KEY,envelope TEXT,status TEXT,run_at INTEGER,fetched_at INTEGER,raw_sha256 TEXT,collector_version TEXT,updated_at INTEGER,write_seq INTEGER,operation_id TEXT);
    CREATE TABLE usage_event(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT,run_at INTEGER,status TEXT,raw_sha256 TEXT,envelope TEXT,operation_id TEXT UNIQUE);`)
  const apply = (operation: ReturnType<typeof create>) => {
    const batch = successValue(buildD1WriteBatch(operation))
    db.exec('BEGIN')
    try { for (const statement of batch) db.prepare(statement.sql).run(...statement.params); db.exec('COMMIT') }
    catch (error) { db.exec('ROLLBACK'); throw error }
  }
  return { db, apply }
}

describe('Given one durable CollectorD1Write v1 observation', () => {
  it('When creating it Then hashes the exact v1 tuple and leaves envelope bytes unchanged on replay', () => {
    const json = '  ' + JSON.stringify(d1Envelope()) + '\n'
    const op = create(true, 1, D1_OPERATION_ID, json)
    expect(op).toEqual({ version: 1, operationId: D1_OPERATION_ID, provider: 'claude', writeSeq: 1, envelopeJson: json, emitEvent: true,
      payloadSha256: sha256Hex(JSON.stringify([1, D1_OPERATION_ID, 'claude', 1, json, true])) })
    expect(buildD1WriteBatch(op)).toEqual(buildD1WriteBatch(op))
    expect(validateCollectorD1Write(op).ok).toBe(true)
  })
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('When seq is %s Then rejects without a rounded replacement', seq => {
    expect(createCollectorD1Write({ operationId: D1_OPERATION_ID, provider: 'claude', writeSeq: seq, envelopeJson: JSON.stringify(d1Envelope()), emitEvent: true }).ok).toBe(false)
  })
  it.each(['not-a-uuid', '11111111-1111-1111-8111-111111111111', '11111111-1111-4111-7111-111111111111'])('When the UUID is %s Then rejects non-v4 identity', operationId => {
    expect(createCollectorD1Write({ operationId, provider: 'claude', writeSeq: 1, envelopeJson: JSON.stringify(d1Envelope()), emitEvent: true }).ok).toBe(false)
  })
  it('When provider, JSON or payload hash is corrupt Then returns only a safe failure', () => {
    for (const envelopeJson of ['private malformed content', '[]', '"double encoded"', JSON.stringify(d1Envelope({ provider: 'codex' }))]) {
      const result = createCollectorD1Write({ operationId: D1_OPERATION_ID, provider: 'claude', writeSeq: 1, envelopeJson, emitEvent: true })
      expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('private malformed')
    }
    expect(buildD1WriteBatch({ ...create(), payloadSha256: '0'.repeat(64) })).toEqual({ ok: false, reason: 'payload_hash_mismatch' })
  })
  it('When emitEvent is false Then produces only receipt and snapshot with fixed epoch-ms params', () => {
    const statements = successValue(buildD1WriteBatch(create(false)))
    expect(statements).toHaveLength(2)
    expect(statements[0].params).toContain(Date.parse(D1_NOW))
    expect(statements[1].params).toContain(Date.parse(D1_NOW))
    expect(statements.every(s => !/\b(BEGIN|COMMIT|SET LOCAL)\b/i.test(s.sql))).toBe(true)
  })
})

describe('Given receipt, snapshot and conditional event statements in one transaction', () => {
  it('When a receipt is replayed Then records one event and does not change receipt creation time', () => {
    const { db, apply } = database()
    try {
      const op = create(); apply(op); const before = db.prepare('SELECT * FROM usage_write_receipt').get()
      apply(op); apply(op)
      expect(db.prepare('SELECT count(*) AS n FROM usage_event').get()?.n).toBe(1)
      expect(db.prepare('SELECT * FROM usage_write_receipt').get()).toEqual(before)
    } finally { db.close() }
  })
  it('When an older observation arrives after a newer snapshot Then inserts its missing event without regressing the snapshot', () => {
    const { db, apply } = database()
    try {
      apply(create(true, 2, '22222222-2222-4222-8222-222222222222')); apply(create())
      expect(db.prepare('SELECT write_seq FROM usage_snapshot').get()?.write_seq).toBe(2)
      expect(db.prepare('SELECT count(*) AS n FROM usage_event').get()?.n).toBe(2)
    } finally { db.close() }
  })
  it('When the same key has a new payload or the same seq has another key Then rolls back every statement', () => {
    const { db, apply } = database()
    try {
      apply(create())
      const conflict = create(true, 9, D1_OPERATION_ID, JSON.stringify(d1Envelope({ intervalSec: 180 })))
      expect(() => apply(conflict)).toThrow()
      expect(() => apply(create(true, 1, '22222222-2222-4222-8222-222222222222'))).toThrow()
      expect(db.prepare('SELECT count(*) AS n FROM usage_write_receipt').get()?.n).toBe(1)
      expect(db.prepare('SELECT write_seq FROM usage_snapshot').get()?.write_seq).toBe(1)
      expect(db.prepare('SELECT count(*) AS n FROM usage_event').get()?.n).toBe(1)
    } finally { db.close() }
  })
  it('When the last event statement fails Then neither receipt nor snapshot commits', () => {
    const { db, apply } = database()
    try {
      db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON usage_event BEGIN SELECT RAISE(ABORT,'synthetic'); END")
      expect(() => apply(create())).toThrow()
      expect(db.prepare('SELECT count(*) AS n FROM usage_write_receipt').get()?.n).toBe(0)
      expect(db.prepare('SELECT count(*) AS n FROM usage_snapshot').get()?.n).toBe(0)
      apply(create(false))
      expect(db.prepare('SELECT count(*) AS n FROM usage_event').get()?.n).toBe(0)
    } finally { db.close() }
  })
})
