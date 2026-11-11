import type { UsageCollectionMeta, UsageSnapshot } from '../../../shared/usage-contract'
import type { UsageGatewayResult } from './gateway'
import type { RawUsage } from './types'

/**
 * 봉투 응답(/api/usage) 해석. Worker가 봉투를 가공하지 않으므로(ADR 0.2 D8)
 * 형식 오류는 `api_error: invalid_response`로, 해석에 성공하면 raw 응답과
 * 수집 메타를 그대로 app에 넘긴다. 내용을 가공하지 않는다.
 */

/** 스택 부록 A 통합: 스냅샷 게이트웨이 결과는 공용 포트 형태와 같다. */
export type SnapshotGatewayResult = UsageGatewayResult

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const nullableDate = (v: unknown) => v === null || date(v)

export function decodeUsageSnapshot(body: unknown): UsageGatewayResult {
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
    catch { /* rawText 원문은 raw 보기 폴백을 위해 그대로 둔다. */ }
  }
  return { ok: true, usage, collection, rawText }
}
