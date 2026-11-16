import { describe, expect, it } from 'vitest'
import { toPgRollbackEvent, toPgRollbackSnapshot, normalizeMigrationRow, classifyPgRollbackRow, migrationRowSha256 } from '../../../../collector/domain/usage/d1-migration.mjs'
import { classifyD1Operation } from '../../../../collector/domain/usage/d1-reconciliation.mjs'
import { createCollectorD1Write } from '../../../../collector/domain/usage/d1-write-contract.mjs'
import { migrationRowTuple } from '../../../../shared/d1-canonical'
import { sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'
import { D1_NOW, D1_OPERATION_ID, d1Envelope, successValue } from '../../../fakes/d1-contract'

function eventRow() {
  return { id: '9007199254740993', provider: 'claude' as const, runAt: D1_NOW, status: 'ok' as const, rawSha256: sha256Hex(d1Envelope().rawText!), envelopeJson: JSON.stringify(d1Envelope()) }
}
describe('Given the z-ds 912d373 PG rollback transport rows', () => {
  it('When exporting an event Then preserves the decimal id and original envelope with exact field names', () => {
    const row = eventRow(), value = successValue(toPgRollbackEvent(row))
    expect(value).toEqual({ id: row.id, provider: 'claude', runAtMs: Date.parse(D1_NOW), status: 'ok', rawSha256: row.rawSha256, envelope: row.envelopeJson })
    expect(normalizeMigrationRow(value)).toEqual({ ok: true, value: row })
    expect(migrationRowSha256(value)).toEqual(migrationRowSha256(row))
    expect(Object.keys(value)).not.toContain('operation_id')
    expect(Object.keys(value)).not.toContain('write_seq')
  })
  it('When exporting a snapshot Then uses the provider hash key and derives envelope metadata without copying D1-only fields', () => {
    const row = { ...eventRow(), id: null }, updatedAtMs = Date.parse(D1_NOW) + 1
    const value = successValue(toPgRollbackSnapshot(row, updatedAtMs))
    expect(value).toEqual({ provider: 'claude', runAtMs: Date.parse(D1_NOW), fetchedAtMs: Date.parse(D1_NOW), status: 'ok', rawSha256: row.rawSha256, envelope: row.envelopeJson, collectorVersion: '0.6.20', updatedAtMs })
    expect(successValue(migrationRowTuple(row)).startsWith('claude|claude|')).toBe(true)
    expect(migrationRowSha256(value)).toEqual(migrationRowSha256(row))
  })
  it('When transport ids, epochs or duplicated snapshot metadata are invalid Then stops without rounding', () => {
    const event = successValue(toPgRollbackEvent(eventRow()))
    for (const patch of [{ id: 9007199254740992 }, { runAtMs: 1.5 }, { runAtMs: Number.MAX_SAFE_INTEGER }]) expect(normalizeMigrationRow({ ...event, ...patch }).ok).toBe(false)
    const snapshot = successValue(toPgRollbackSnapshot({ ...eventRow(), id: null }, Date.parse(D1_NOW)))
    for (const patch of [{ fetchedAtMs: 0 }, { collectorVersion: 'different' }, { updatedAtMs: NaN }]) expect(normalizeMigrationRow({ ...snapshot, ...patch }).ok).toBe(false)
    expect(toPgRollbackSnapshot(eventRow(), 0).ok).toBe(false)
    expect(toPgRollbackEvent({ ...eventRow(), id: null }).ok).toBe(false)
  })
  it('When a legitimate D1 latest snapshot differs from the frozen PG snapshot Then plans replacement while event conflicts remain fatal', () => {
    const latest = { ...eventRow(), id: null }
    const olderAt = '2026-11-16T02:45:00.123Z'
    const previous = { ...latest, runAt: olderAt, envelopeJson: JSON.stringify(d1Envelope({ runAt: olderAt, fetchedAt: olderAt })) }
    expect(classifyPgRollbackRow(latest, previous)).toEqual({ ok: true, value: 'snapshot_replace' })
    expect(classifyPgRollbackRow(eventRow(), { ...eventRow(), envelopeJson: JSON.stringify(d1Envelope({ intervalSec: 180 })) })).toEqual({ ok: false, reason: 'migration_hash_mismatch' })
  })
  it('When receipt/outbox comparison receives native PG rows Then shares the same classification boundary', () => {
    const row = eventRow(), op = successValue(createCollectorD1Write({ operationId: D1_OPERATION_ID, provider: 'claude', writeSeq: 1, envelopeJson: row.envelopeJson, emitEvent: true }))
    const receipt = { operationId: op.operationId, provider: op.provider, writeSeq: op.writeSeq, payloadSha256: op.payloadSha256, createdAtMs: Date.parse(D1_NOW) }
    const native = successValue(toPgRollbackEvent(row))
    expect(successValue(classifyD1Operation({ operation: op, outboxPresent: true, receipt, pgRow: { expected: native, actual: native } }))).toMatchObject({ pg: 'matching', action: 'clear_after_pg_commit' })
  })
})
