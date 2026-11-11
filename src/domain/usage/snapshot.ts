import type { UsageCollectionMeta, UsageSnapshot } from '../../../shared/usage-contract'
import type { RawUsage } from './types'
import type { UsageGatewayFailureReason } from './gateway'
export type SnapshotGatewayResult =
  | { ok: true; usage: RawUsage | null; collection: UsageCollectionMeta | null; rawText: string | null }
  | { ok: false; reason: UsageGatewayFailureReason; message: string | null }
/** Separate snapshot port while the existing mock UI contract awaits integration. */
export interface SnapshotUsageGateway { fetchUsage(): Promise<SnapshotGatewayResult> }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const nullableDate = (v: unknown) => v === null || date(v)
export function decodeUsageSnapshot(body: unknown): SnapshotGatewayResult {
  const failure = { ok: false as const, reason: 'api_error' as const, message: 'invalid_response' }
  if (!isObject(body)) return failure
  if (body.snapshot === null) return { ok: true, usage: null, collection: null, rawText: null }
  const s = body.snapshot
  if (!isObject(s) || s.schema !== 1 || s.provider !== 'claude' ||
    !['ok', 'rate_limited', 'token_expired', 'auth_required', 'no_credentials', 'upstream_error', 'network_error'].includes(s.status as string) ||
    typeof s.called !== 'boolean' || !date(s.runAt) || !nullableDate(s.fetchedAt) || !nullableDate(s.retryAt) ||
    !nullableDate(s.tokenExpiresAt) || !nullableDate(s.kvTokenExpiresAt) ||
    !(s.httpStatus === null || (typeof s.httpStatus === 'number' && Number.isInteger(s.httpStatus) && s.httpStatus >= 100 && s.httpStatus <= 599)) ||
    typeof s.intervalSec !== 'number' || !Number.isFinite(s.intervalSec) || s.intervalSec <= 0 ||
    typeof s.collectorVersion !== 'string' || !(s.rawText === null || typeof s.rawText === 'string') ||
    !(s.rawOmitted === null || s.rawOmitted === 'too_large')) return failure
  const { rawText, ...collection } = s as unknown as UsageSnapshot
  let usage: RawUsage | null = null
  if (rawText !== null) {
    try { const parsed: unknown = JSON.parse(rawText); if (isObject(parsed)) usage = parsed as RawUsage }
    catch { /* Keep original text for the raw view when parsing fails. */ }
  }
  return { ok: true, usage, collection, rawText }
}
