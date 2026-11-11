import type { UsageCollectionMeta, UsageSnapshot } from '../../../shared/usage-contract'
import type { UsageGatewayResult } from './gateway'
import type { UsageProvider } from './providers'

/**
 * 봉투 응답(`/api/usage/:provider`) 해석 (ADR 0.3 D7·D8).
 * Worker가 봉투를 가공하지 않으므로 형식 오류는 `api_error: invalid_response`로 돌려준다.
 * 요청한 제공자와 봉투의 provider가 다르면 실패다(키가 섞였을 때 다른 값이 나가지 않게).
 */

export type SnapshotGatewayResult = UsageGatewayResult

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const date = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value))
const nullableDate = (value: unknown): boolean => value === null || date(value)

const STATUSES: readonly string[] = [
  'ok',
  'rate_limited',
  'token_expired',
  'auth_required',
  'auth_rejected',
  'no_credentials',
  'upstream_error',
  'network_error',
]

export function decodeUsageSnapshot(body: unknown, provider: UsageProvider): UsageGatewayResult {
  const failure = { ok: false as const, reason: 'api_error' as const, message: 'invalid_response' }
  if (!isObject(body)) return failure
  if (body.snapshot === null) return { ok: true, usage: null, collection: null, rawText: null }
  const snapshot = body.snapshot
  if (
    !isObject(snapshot) ||
    snapshot.schema !== 1 ||
    snapshot.provider !== provider ||
    !STATUSES.includes(snapshot.status as string) ||
    typeof snapshot.called !== 'boolean' ||
    !date(snapshot.runAt) ||
    !nullableDate(snapshot.fetchedAt) ||
    !nullableDate(snapshot.retryAt) ||
    !nullableDate(snapshot.tokenExpiresAt) ||
    !nullableDate(snapshot.kvTokenExpiresAt) ||
    !(
      snapshot.httpStatus === null ||
      (typeof snapshot.httpStatus === 'number' && Number.isInteger(snapshot.httpStatus) && snapshot.httpStatus >= 100 && snapshot.httpStatus <= 599)
    ) ||
    typeof snapshot.intervalSec !== 'number' ||
    !Number.isFinite(snapshot.intervalSec) ||
    snapshot.intervalSec <= 0 ||
    typeof snapshot.collectorVersion !== 'string' ||
    !(snapshot.rawText === null || typeof snapshot.rawText === 'string') ||
    !(snapshot.rawOmitted === null || snapshot.rawOmitted === 'too_large')
  ) {
    return failure
  }

  const { rawText, ...collection } = snapshot as unknown as UsageSnapshot
  let usage: Record<string, unknown> | null = null
  if (rawText !== null) {
    try {
      const parsed: unknown = JSON.parse(rawText)
      if (isObject(parsed)) usage = parsed
    } catch {
      /* rawText 원문은 raw 보기 폴백을 위해 그대로 둔다. */
    }
  }
  return { ok: true, usage, collection, rawText }
}
