/** Deterministic migration checks; database and filesystem operations belong to later patches. */
import { isRecord, migrationRowTuple, normalizeD1Instant, parseD1Envelope } from '../../../shared/d1-canonical.ts'
import { sha256Hex } from './envelope.mjs'
/** @typedef {import('../../../shared/d1-contract.ts').D1MigrationRow} MigrationRow */
/** @typedef {import('../../../shared/d1-contract.ts').PgRollbackEventRow} PgEvent */
/** @typedef {import('../../../shared/d1-contract.ts').PgRollbackSnapshotRow} PgSnapshot */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */

/** @param {unknown} value @returns {Result<{ms:number,iso:string}>} */
function epoch(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) return { ok:false,reason:'invalid_migration_row' }
  return normalizeD1Instant(new Date(value).toISOString())
}
/** Accepts the canonical input or z-ds's epoch-ms/envelope transport; never rounds ids.
 * @param {unknown} input @returns {Result<MigrationRow>} */
export function normalizeMigrationRow(input) {
  if (!isRecord(input)) return { ok:false,reason:'invalid_migration_row' }
  if (typeof input.envelopeJson === 'string') {
    const tuple = migrationRowTuple(input), at = normalizeD1Instant(input.runAt)
    if (!tuple.ok) return tuple
    if (!at.ok) return at
    return { ok:true,value:/** @type {MigrationRow} */ ({id:input.id,provider:input.provider,runAt:at.value.iso,status:input.status,rawSha256:input.rawSha256,envelopeJson:input.envelopeJson}) }
  }
  const at = epoch(input.runAtMs), parsed = parseD1Envelope(input.envelope)
  if (!at.ok || !parsed.ok) return { ok:false,reason:'invalid_migration_row' }
  if (!('id' in input)) {
    const updated = epoch(input.updatedAtMs), fetched = input.fetchedAtMs === null ? null : epoch(input.fetchedAtMs)
    const envelopeFetched = parsed.value.fetchedAt === null ? null : normalizeD1Instant(parsed.value.fetchedAt)
    if (!updated.ok || (fetched !== null && !fetched.ok) || (envelopeFetched !== null && !envelopeFetched.ok)
      || (fetched === null) !== (envelopeFetched === null)
      || (fetched?.ok && envelopeFetched?.ok && fetched.value.ms !== envelopeFetched.value.ms)
      || input.collectorVersion !== parsed.value.collectorVersion) return { ok:false,reason:'invalid_migration_row' }
  }
  return normalizeMigrationRow({ id:'id' in input ? input.id : null,provider:input.provider,runAt:at.value.iso,status:input.status,rawSha256:input.rawSha256,envelopeJson:input.envelope })
}
/** @param {unknown} row @returns {Result<string>} */
export function migrationRowSha256(row) {
  const normalized = normalizeMigrationRow(row)
  if (!normalized.ok) return normalized
  const tuple = migrationRowTuple(normalized.value)
  return tuple.ok ? { ok:true,value:sha256Hex(tuple.value) } : tuple
}
/** Strict verification, including snapshots. A rollback replacement is classified separately.
 * @param {unknown} expected @param {unknown} actual @returns {Result<'matching'>} */
export function compareMigrationRows(expected, actual) {
  const a = normalizeMigrationRow(expected), b = normalizeMigrationRow(actual)
  if (!a.ok) return a
  if (!b.ok) return b
  if (a.value.id !== b.value.id || a.value.provider !== b.value.provider) return { ok:false,reason:'migration_identity_mismatch' }
  const first = migrationRowSha256(a.value), second = migrationRowSha256(b.value)
  if (!first.ok) return first
  if (!second.ok) return second
  return first.value === second.value ? { ok:true,value:'matching' } : { ok:false,reason:'migration_hash_mismatch' }
}
/** Event conflicts stop rollback. A different latest snapshot is an explicit replacement (§11 D).
 * @param {unknown} expected @param {unknown} actual @returns {Result<'missing'|'matching'|'snapshot_replace'>} */
export function classifyPgRollbackRow(expected, actual) {
  const a = normalizeMigrationRow(expected)
  if (!a.ok) return a
  if (actual === null) return { ok:true,value:'missing' }
  const b = normalizeMigrationRow(actual)
  if (!b.ok) return b
  const compared = compareMigrationRows(a.value,b.value)
  if (compared.ok) return compared
  if (compared.reason === 'migration_hash_mismatch' && a.value.id === null && b.value.id === null) return { ok:true,value:'snapshot_replace' }
  return compared
}
/** @param {unknown} input @returns {Result<PgEvent>} */
export function toPgRollbackEvent(input) {
  const row = normalizeMigrationRow(input)
  if (!row.ok) return row
  const r = row.value
  if (r.id === null) return { ok:false,reason:'invalid_event_row' }
  return { ok:true,value:{id:r.id,provider:r.provider,runAtMs:Date.parse(r.runAt),status:r.status,rawSha256:r.rawSha256,envelope:r.envelopeJson} }
}
/** updatedAtMs is the explicit persisted D1 column, not an invented retry timestamp.
 * @param {unknown} input @param {unknown} updatedAtMs @returns {Result<PgSnapshot>} */
export function toPgRollbackSnapshot(input, updatedAtMs) {
  const row = normalizeMigrationRow(input), updated = epoch(updatedAtMs)
  if (!row.ok) return row
  if (row.value.id !== null || !updated.ok) return { ok:false,reason:'invalid_snapshot_row' }
  const r = row.value, parsed = parseD1Envelope(r.envelopeJson)
  if (!parsed.ok) return parsed
  const fetched = parsed.value.fetchedAt === null ? null : normalizeD1Instant(parsed.value.fetchedAt)
  if (fetched !== null && !fetched.ok) return fetched
  return { ok:true,value:{provider:r.provider,runAtMs:Date.parse(r.runAt),fetchedAtMs:fetched?.ok ? fetched.value.ms : null,status:r.status,
    rawSha256:r.rawSha256,envelope:r.envelopeJson,collectorVersion:parsed.value.collectorVersion,updatedAtMs:updated.value.ms} }
}
