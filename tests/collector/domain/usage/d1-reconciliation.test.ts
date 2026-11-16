import { describe, expect, it } from 'vitest'
import { classifyD1Operation } from '../../../../collector/domain/usage/d1-reconciliation.mjs'
import { createCollectorD1Write } from '../../../../collector/domain/usage/d1-write-contract.mjs'
import { sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'
import { D1_OPERATION_ID, D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'

function facts() {
  const op = successValue(createCollectorD1Write({ operationId: D1_OPERATION_ID, provider: 'claude', writeSeq: 7, envelopeJson: JSON.stringify(d1Envelope()), emitEvent: true }))
  const receipt = { operationId: op.operationId, provider: op.provider, writeSeq: op.writeSeq, payloadSha256: op.payloadSha256, createdAtMs: Date.parse(D1_NOW) }
  const expected = { id: '9007199254740993', provider: op.provider, status: 'ok' as const, runAt: D1_NOW, rawSha256: sha256Hex(d1Envelope().rawText!), envelopeJson: op.envelopeJson }
  return { op, receipt, expected }
}
describe('Given quiesced receipt, local outbox and optional PG migration facts', () => {
  it('When local ack is complete, response is lost or receipt is absent Then classifies without minting another operation', () => {
    const { op, receipt } = facts()
    expect(successValue(classifyD1Operation({ operation: op, receipt, outboxPresent: false }))).toMatchObject({ delivery: 'acknowledged', action: 'none', operationId: op.operationId })
    expect(successValue(classifyD1Operation({ operation: op, receipt, outboxPresent: true }))).toMatchObject({ delivery: 'response_lost', action: 'acknowledge_local', operationId: op.operationId })
    expect(successValue(classifyD1Operation({ operation: op, receipt: null, outboxPresent: true }))).toMatchObject({ delivery: 'unsent', action: 'replay_same_operation', operationId: op.operationId })
  })
  it('When rollback replaces a snapshot Then clears a receipted outbox only after PG commit and drains an unsent operation first', () => {
    const { op, receipt, expected } = facts()
    const snapshot = { ...expected, id: null }
    const older = '2026-11-16T02:45:00.000Z'
    const actual = { ...snapshot, runAt: older, envelopeJson: JSON.stringify(d1Envelope({ runAt: older, fetchedAt: older })) }
    const pgRow = { expected: snapshot, actual }
    expect(successValue(classifyD1Operation({ operation: op, receipt, outboxPresent: true, pgRow })))
      .toMatchObject({ pg: 'snapshot_replace', delivery: 'response_lost', action: 'clear_after_pg_commit' })
    expect(successValue(classifyD1Operation({ operation: op, receipt: null, outboxPresent: true, pgRow })))
      .toMatchObject({ pg: 'snapshot_replace', delivery: 'unsent', action: 'replay_same_operation' })
    expect(successValue(classifyD1Operation({ operation: op, receipt, outboxPresent: false, pgRow })))
      .toMatchObject({ pg: 'snapshot_replace', delivery: 'acknowledged', action: 'none' })
  })
  it('When receipt identity or seq is inconsistent Then stops instead of renumbering; unavailable is not absent', () => {
    const { op, receipt } = facts()
    for (const patch of [{ writeSeq: 8 }, { operationId: '22222222-2222-4222-8222-222222222222' }, { payloadSha256: 'f'.repeat(64) }]) {
      expect(classifyD1Operation({ operation: op, receipt: { ...receipt, ...patch }, outboxPresent: true })).toEqual({ ok: false, reason: 'receipt_conflict' })
    }
    expect(classifyD1Operation({ operation: op, receipt: null, outboxPresent: true, receiptUnavailable: true })).toEqual({ ok: false, reason: 'receipt_unavailable' })
    expect(classifyD1Operation({ operation: op, receipt: null, outboxPresent: false }).ok).toBe(false)
  })
  it('When an explicit PG target is supplied Then compares the full row and rejects a conflicting or unrelated operation target', () => {
    const { op, receipt, expected } = facts()
    const base = { operation: op, receipt, outboxPresent: true }
    expect(successValue(classifyD1Operation({ ...base, pgRow: { expected, actual: null } })).pg).toBe('missing')
    expect(successValue(classifyD1Operation({ ...base, pgRow: { expected, actual: expected } }))).toMatchObject({ pg: 'matching', action: 'clear_after_pg_commit' })
    const changed = { ...expected, envelopeJson: JSON.stringify(d1Envelope({ intervalSec: 180 })) }
    expect(classifyD1Operation({ ...base, pgRow: { expected, actual: changed } })).toEqual({ ok: false, reason: 'migration_hash_mismatch' })
    expect(classifyD1Operation({ ...base, pgRow: { expected: changed, actual: changed } }).ok).toBe(false)
    expect(op.operationId).toBe(D1_OPERATION_ID)
  })
})


describe('Given invalid reconciliation input from a diagnostic reader', () => {
  it('When facts or PG facts are malformed Then returns a safe union without throwing', () => {
    const { op, receipt } = facts()
    for (const input of [null, {}, { operation: op, receipt, outboxPresent: true, pgRow: null }, { operation: op, receipt, outboxPresent: true, pgRow: {} }]) {
      expect(() => { expect(classifyD1Operation(input as never).ok).toBe(false) }).not.toThrow()
    }
  })
})
