/**
 * 봉투(envelope)·KV 키 계약(ADR 0.2 D4). 프론트(`src/`)와 Worker(`worker/`)의 domain이
 * import하고, 수집기(`collector/`, .mjs)는 JSDoc `@typedef {import('...')}` 로 참조한다.
 * 로직은 두지 않는다.
 *
 * 두 트랙에서 같은 구조를 각자 이름으로 부르던 것을 하나로 합쳤다.
 * - `UsageEnvelope`/`UsageStatus` (수집기 트랙) — 정본
 * - `UsageSnapshot`/`CollectionStatus` (Worker 트랙) — 같은 계약의 별칭
 */

export const USAGE_SNAPSHOT_SCHEMA = 1
export const USAGE_INTERVAL_SEC = 300
export const USAGE_COLLECTOR_VERSION = '0.3.0'

/** 수집 대상 제공자(ADR 0.3 D3). 제공자 목록은 정적이다. */
export const USAGE_PROVIDERS = ['claude', 'codex'] as const
export type UsageProvider = (typeof USAGE_PROVIDERS)[number]

/** 제공자별 KV 키(ADR 0.3 D5). 문자열로 키를 조립하지 않는다. */
export const USAGE_KV_KEYS: Record<UsageProvider, string> = {
  claude: 'usage:claude',
  codex: 'usage:codex',
}

/** 수집기가 본 상태. Worker·저장소 문제는 봉투에 들어가지 않는다. */
export type UsageStatus =
  | 'ok'
  | 'rate_limited'
  | 'token_expired'
  | 'auth_required'
  | 'auth_rejected'
  | 'no_credentials'
  | 'upstream_error'
  | 'network_error'

/** Worker 트랙의 이름(같은 유니온). */
export type CollectionStatus = UsageStatus

export interface UsageEnvelope {
  /** 계약 버전(USAGE_SNAPSHOT_SCHEMA) */
  schema: typeof USAGE_SNAPSHOT_SCHEMA
  provider: UsageProvider
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
  /** 식별자 가림(D5)이 적용된 키 경로. 목록이 비었으면 필드가 없다 */
  rawRedacted?: string[]
}

/** Worker 트랙의 이름(같은 계약). */
export type UsageSnapshot = UsageEnvelope

/** `rawText`를 뺀 수집 메타. 프론트가 화면에 쓰는 부분. */
export type UsageCollectionMeta = Omit<UsageEnvelope, 'rawText'>
