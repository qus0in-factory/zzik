/** Pure ADR 0.10 canonicalization. No clock, crypto implementation, filesystem or driver. */
import { USAGE_PROVIDERS } from './usage-contract.ts'
import type { UsageEnvelope, UsageProvider, UsageStatus } from './usage-contract.ts'
import type { D1Result } from './d1-contract.ts'

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const isUsageProvider = (value: unknown): value is UsageProvider => typeof value === 'string' && (USAGE_PROVIDERS as readonly string[]).includes(value)
const STATUSES: readonly string[] = ['ok', 'rate_limited', 'token_expired', 'auth_required', 'auth_rejected', 'no_credentials', 'upstream_error', 'network_error']
export const isUsageStatus = (value: unknown): value is UsageStatus => typeof value === 'string' && STATUSES.includes(value)
export const isDecimalEventId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

interface Instant { ms: number; iso: string; micros: bigint }
function instant(value: unknown): Instant | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value)
  if (!match) return null
  const fraction = (match[3] ?? '').padEnd(6, '0')
  const local = `${match[1]}T${match[2]}.${fraction.slice(0, 3)}Z`
  const localMs = Date.parse(local)
  if (!Number.isSafeInteger(localMs) || new Date(localMs).toISOString() !== local) return null
  let offset = 0
  if (match[4] !== 'Z') {
    const hours = Number(match[4].slice(1, 3)), minutes = Number(match[4].slice(4, 6))
    if (hours > 23 || minutes > 59) return null
    offset = (hours * 60 + minutes) * 60_000 * (match[4][0] === '+' ? 1 : -1)
  }
  const ms = localMs - offset
  if (!Number.isSafeInteger(ms)) return null
  const iso = new Date(ms).toISOString()
  if (!/^\d{4}-/.test(iso)) return null
  return { ms, iso, micros: BigInt(ms) * 1000n + BigInt(fraction.slice(3)) }
}
export function normalizeD1Instant(value: unknown): D1Result<{ ms: number; iso: string }> {
  const parsed = instant(value)
  return parsed === null ? { ok: false, reason: 'invalid_instant' } : { ok: true, value: { ms: parsed.ms, iso: parsed.iso } }
}

function canonical(value: unknown): string | null {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? JSON.stringify(value) : null
  if (Array.isArray(value)) {
    const items = value.map(canonical)
    return items.some(item => item === null) ? null : '[' + items.join(',') + ']'
  }
  if (!isRecord(value)) return null
  const pairs: string[] = []
  for (const key of Object.keys(value).sort()) {
    const item = canonical(value[key])
    if (item === null) return null
    pairs.push(JSON.stringify(key) + ':' + item)
  }
  return '{' + pairs.join(',') + '}'
}
/** Sort object keys recursively; preserve array order and opaque rawText bytes. */
export function canonicalEnvelope(json: unknown): D1Result<string> {
  if (typeof json !== 'string') return { ok: false, reason: 'invalid_envelope' }
  try {
    const parsed: unknown = JSON.parse(json)
    const value = isRecord(parsed) ? canonical(parsed) : null
    return value === null ? { ok: false, reason: 'invalid_envelope' } : { ok: true, value }
  } catch { return { ok: false, reason: 'invalid_envelope' } }
}

export function parseD1Envelope(json: unknown): D1Result<UsageEnvelope> {
  const sorted = canonicalEnvelope(json)
  if (!sorted.ok) return sorted
  const e: Record<string, unknown> = JSON.parse(sorted.value)
  const nullableInstant = (v: unknown): boolean => v === null || instant(v) !== null
  if (e.schema !== 1 || !isUsageProvider(e.provider) || !isUsageStatus(e.status) || typeof e.called !== 'boolean' || instant(e.runAt) === null
    || !nullableInstant(e.fetchedAt) || !nullableInstant(e.retryAt) || !nullableInstant(e.tokenExpiresAt) || !nullableInstant(e.kvTokenExpiresAt)
    || !(e.httpStatus === null || (typeof e.httpStatus === 'number' && Number.isInteger(e.httpStatus) && e.httpStatus >= 100 && e.httpStatus <= 599))
    || typeof e.intervalSec !== 'number' || !Number.isFinite(e.intervalSec) || e.intervalSec <= 0 || typeof e.collectorVersion !== 'string'
    || !(e.rawText === null || typeof e.rawText === 'string') || !(e.rawOmitted === null || e.rawOmitted === 'too_large')
    || (e.rawRedacted !== undefined && (!Array.isArray(e.rawRedacted) || !e.rawRedacted.every(p => typeof p === 'string')))) {
    return { ok: false, reason: 'invalid_envelope' }
  }
  return { ok: true, value: e as unknown as UsageEnvelope }
}

/** Exact §4.4 wire tuple. Snapshot key=provider, empty raw_sha256=null; canonical envelope is the last field. */
export function migrationRowTuple(input: unknown): D1Result<string> {
  if (!isRecord(input) || !(input.id === null || isDecimalEventId(input.id)) || !isUsageProvider(input.provider) || !isUsageStatus(input.status)
    || !(input.rawSha256 === null || isSha256(input.rawSha256))) return { ok: false, reason: 'invalid_migration_row' }
  const at = normalizeD1Instant(input.runAt), parsed = parseD1Envelope(input.envelopeJson), sorted = canonicalEnvelope(input.envelopeJson)
  if (!at.ok || !parsed.ok || !sorted.ok) return { ok: false, reason: 'invalid_migration_row' }
  const envelopeAt = normalizeD1Instant(parsed.value.runAt)
  if (!envelopeAt.ok || envelopeAt.value.ms !== at.value.ms || parsed.value.provider !== input.provider || parsed.value.status !== input.status) {
    return { ok: false, reason: 'migration_column_mismatch' }
  }
  return { ok: true, value: [input.id ?? input.provider, input.provider, String(at.value.ms), input.status, input.rawSha256 ?? '', sorted.value].join('|') }
}

/** Checks full PG precision against (Worker ms,id), per provider, before losing sub-ms data. */
export function checkMigrationTimeOrder(rows: unknown): D1Result<null> {
  if (!Array.isArray(rows)) return { ok: false, reason: 'invalid_migration_row' }
  const groups = new Map<string, { id: string; time: Instant }[]>()
  const ids = new Set<string>()
  for (const row of rows) {
    if (!isRecord(row)) return { ok: false, reason: 'invalid_migration_row' }
    const time = instant(row.runAt)
    if (!time || !isDecimalEventId(row.id) || !isUsageProvider(row.provider) || ids.has(row.id)) return { ok: false, reason: 'invalid_migration_row' }
    ids.add(row.id)
    const group = groups.get(row.provider) ?? []
    group.push({ id: row.id, time }); groups.set(row.provider, group)
  }
  const compare = (a: bigint, b: bigint): number => a < b ? -1 : a > b ? 1 : 0
  for (const group of groups.values()) {
    const pg = [...group].sort((a, b) => compare(a.time.micros, b.time.micros) || compare(BigInt(a.id), BigInt(b.id)))
    const ms = [...group].sort((a, b) => a.time.ms - b.time.ms || compare(BigInt(a.id), BigInt(b.id)))
    if (pg.some((row, index) => row.id !== ms[index].id)) return { ok: false, reason: 'millisecond_order_changed' }
  }
  return { ok: true, value: null }
}
