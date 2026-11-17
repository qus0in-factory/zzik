/** Deterministic migration checks; database and filesystem operations belong to later patches. */
import { isRecord, migrationRowTuple, normalizeD1Instant, parseD1Envelope } from '../../../shared/d1-canonical.ts'
import { sha256Hex } from './envelope.mjs'
/** @typedef {import('../../../shared/d1-contract.ts').D1MigrationRow} MigrationRow */
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
