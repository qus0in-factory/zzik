/**
 * 봉투(envelope)와 KV 키의 계약(ADR 0.2 D4). 프론트와 Worker의 domain이 import하고,
 * 수집기는 JSDoc `@typedef {import('...')}` 로 참조한다. 로직은 두지 않는다.
 */

export const USAGE_SNAPSHOT_SCHEMA = 1
export const USAGE_KEY = 'usage:claude'
export const USAGE_INTERVAL_SEC = 300
export const USAGE_COLLECTOR_VERSION = '0.2.0'

export type UsageStatus =
  | 'ok'
  | 'rate_limited'
  | 'token_expired'
  | 'auth_required'
  | 'no_credentials'
  | 'upstream_error'
  | 'network_error'

export interface UsageEnvelope {
  /** 계약 버전(USAGE_SNAPSHOT_SCHEMA) */
  schema: number
  provider: string
  /** 수집기가 본 상태(Worker/저장소 문제는 봉투에 들어가지 않는다) */
  status: UsageStatus
  /** 이번 실행에서 upstream을 실제로 호출했는가 */
  called: boolean
  /** 마지막 수집기 실행 시각(하트비트) */
  runAt: string
  /** 마지막 성공 시각, 없으면 null */
  fetchedAt: string | null
  /** 마지막 실제 호출의 상태 코드. 건너뛴 실행에서도 유지 */
  httpStatus: number | null
  /** 다음 호출이 허용되는 시각(D5 게이트의 사본), 게이트가 없으면 null */
  retryAt: string | null
  /** Claude 자격 증명의 expiresAt, 모르면 null */
  tokenExpiresAt: string | null
  /** Cloudflare API 토큰 만료일, 모르면 null */
  kvTokenExpiresAt: string | null
  /** 수집 주기(초) */
  intervalSec: number
  collectorVersion: string
  /** 마지막 성공 응답 본문 원문, 없으면 null */
  rawText: string | null
  /** 본문을 실지 못한 이유: null | 'too_large' */
  rawOmitted: 'too_large' | null
}
