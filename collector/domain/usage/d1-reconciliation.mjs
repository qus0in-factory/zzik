/** Classifies facts at a quiesced point. Does not ack, drain, import, delete or renumber. */
import { isRecord, canonicalEnvelope, parseD1Envelope } from '../../../shared/d1-canonical.ts'
import { validateCollectorD1Write } from './d1-write-contract.mjs'
import { sha256Hex } from './envelope.mjs'
import { classifyPgRollbackRow, migrationRowSha256, normalizeMigrationRow } from './d1-migration.mjs'
/** @typedef {import('../../../shared/d1-contract.ts').D1OperationFacts} D1OperationFacts */
/** @typedef {import('../../../shared/d1-contract.ts').D1OperationClassification} Classification */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */
/** @param {unknown} input @returns {Result<Classification>} */
export function classifyD1Operation(input) {
  if (!isRecord(input) || typeof input.outboxPresent !== 'boolean' || !('receipt' in input)
    || (input.receiptUnavailable !== undefined && typeof input.receiptUnavailable !== 'boolean')
    || (input.pgRow !== undefined && (!isRecord(input.pgRow) || !isRecord(input.pgRow.expected) || !(input.pgRow.actual === null || isRecord(input.pgRow.actual))))) {
    return { ok: false, reason: 'invalid_operation_facts' }
  }
  const facts = /** @type {D1OperationFacts} */ (/** @type {unknown} */ (input))
  if (facts.receiptUnavailable === true) return { ok: false, reason: 'receipt_unavailable' }
  const checked = validateCollectorD1Write(facts.operation)
  if (!checked.ok) return checked
  const op = checked.value, r = facts.receipt
  if (r !== null && (!isRecord(r) || r.operationId !== op.operationId || r.provider !== op.provider || r.writeSeq !== op.writeSeq || r.payloadSha256 !== op.payloadSha256
    || !Number.isSafeInteger(r.createdAtMs))) return { ok: false, reason: 'receipt_conflict' }
  if (r === null && !facts.outboxPresent) return { ok: false, reason: 'untracked_operation' }
  /** @type {Classification['pg']} */
  let pg = 'not_checked'
  if (facts.pgRow !== undefined) {
    const normalized = normalizeMigrationRow(facts.pgRow.expected)
    if (!normalized.ok) return normalized
    const expected = normalized.value, actual = facts.pgRow.actual
    const expectedHash = migrationRowSha256(expected), a = canonicalEnvelope(expected.envelopeJson), b = canonicalEnvelope(op.envelopeJson)
    const envelope = parseD1Envelope(op.envelopeJson)
    const rawSha = envelope.ok && envelope.value.rawText !== null ? sha256Hex(envelope.value.rawText) : null
    if (!expectedHash.ok || !a.ok || !b.ok || a.value !== b.value || expected.provider !== op.provider || expected.rawSha256 !== rawSha) return { ok: false, reason: 'operation_pg_mismatch' }
    if (actual === null) pg = 'missing'
    else {
      const compared = classifyPgRollbackRow(expected, actual)
      if (!compared.ok) return compared
      pg = compared.value
    }
  }
  return { ok: true, value: { operationId: op.operationId,
    delivery: r === null ? 'unsent' : facts.outboxPresent ? 'response_lost' : 'acknowledged',
    action: pg === 'matching' && facts.outboxPresent ? 'clear_after_pg_commit' : r === null ? 'replay_same_operation' : facts.outboxPresent ? 'acknowledge_local' : 'none', pg } }
}
