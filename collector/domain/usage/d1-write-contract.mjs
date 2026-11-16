/** ADR 0.10 §3. Pure request construction only; never sends or creates an identity. */
import { isRecord, isSha256, isUsageProvider, normalizeD1Instant, parseD1Envelope } from '../../../shared/d1-canonical.ts'
import { sha256Hex } from './envelope.mjs'
/** @typedef {import('../../../shared/d1-contract.ts').CollectorD1WriteV1} CollectorD1WriteV1 */
/** @typedef {import('../../../shared/d1-contract.ts').D1SqlStatement} D1SqlStatement */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */

/** @param {unknown} input @returns {Result<CollectorD1WriteV1>} */
export function createCollectorD1Write(input) {
  if (!isRecord(input) || typeof input.operationId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(input.operationId)
    || !isUsageProvider(input.provider) || typeof input.writeSeq !== 'number' || !Number.isSafeInteger(input.writeSeq) || input.writeSeq < 1
    || typeof input.emitEvent !== 'boolean' || typeof input.envelopeJson !== 'string') return { ok: false, reason: 'invalid_operation' }
  const parsed = parseD1Envelope(input.envelopeJson)
  if (!parsed.ok || parsed.value.provider !== input.provider) return { ok: false, reason: 'invalid_operation' }
  const { operationId, provider, writeSeq, envelopeJson, emitEvent } = input
  const payloadSha256 = sha256Hex(JSON.stringify([1, operationId, provider, writeSeq, envelopeJson, emitEvent]))
  return { ok: true, value: { version: 1, operationId, provider, writeSeq, envelopeJson, emitEvent, payloadSha256 } }
}
/** @param {unknown} input @returns {Result<CollectorD1WriteV1>} */
export function validateCollectorD1Write(input) {
  if (!isRecord(input) || input.version !== 1 || !isSha256(input.payloadSha256)) return { ok: false, reason: 'invalid_operation' }
  const built = createCollectorD1Write(input)
  if (!built.ok) return built
  return built.value.payloadSha256 === input.payloadSha256 ? built : { ok: false, reason: 'payload_hash_mismatch' }
}
/** All temporal params come from the immutable observation, not a retry clock.
 * @param {unknown} input @returns {Result<readonly D1SqlStatement[]>} */
export function buildD1WriteBatch(input) {
  const checked = validateCollectorD1Write(input)
  if (!checked.ok) return checked
  const op = checked.value
  const parsed = parseD1Envelope(op.envelopeJson)
  if (!parsed.ok) return parsed
  const e = parsed.value, at = normalizeD1Instant(e.runAt), fetched = e.fetchedAt === null ? null : normalizeD1Instant(e.fetchedAt)
  if (!at.ok || (fetched !== null && !fetched.ok)) return { ok: false, reason: 'invalid_operation' }
  const runAt = at.value.ms, fetchedAt = fetched?.ok ? fetched.value.ms : null
  const rawSha = e.rawText === null ? null : sha256Hex(e.rawText)
  /** @type {D1SqlStatement[]} */
  const statements = [
    { sql: `INSERT INTO usage_write_receipt (operation_id,provider,write_seq,payload_sha256,created_at_ms) VALUES (?,?,?,?,?)
ON CONFLICT(operation_id) DO UPDATE SET payload_sha256=CASE WHEN usage_write_receipt.payload_sha256=excluded.payload_sha256 THEN usage_write_receipt.payload_sha256 ELSE NULL END`,
    params: [op.operationId, op.provider, op.writeSeq, op.payloadSha256, runAt] },
    { sql: `INSERT INTO usage_snapshot (provider,envelope,status,run_at,fetched_at,raw_sha256,collector_version,updated_at,write_seq,operation_id) VALUES (?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(provider) DO UPDATE SET envelope=excluded.envelope,status=excluded.status,run_at=excluded.run_at,fetched_at=excluded.fetched_at,raw_sha256=excluded.raw_sha256,collector_version=excluded.collector_version,updated_at=excluded.updated_at,write_seq=excluded.write_seq,operation_id=excluded.operation_id
WHERE excluded.write_seq>usage_snapshot.write_seq`,
    params: [op.provider, op.envelopeJson, e.status, runAt, fetchedAt, rawSha, e.collectorVersion, runAt, op.writeSeq, op.operationId] },
  ]
  if (op.emitEvent) statements.push({ sql: 'INSERT INTO usage_event (provider,run_at,status,raw_sha256,envelope,operation_id) VALUES (?,?,?,?,?,?) ON CONFLICT(operation_id) DO NOTHING',
    params: [op.provider, runAt, e.status, rawSha, op.envelopeJson, op.operationId] })
  return { ok: true, value: statements }
}
