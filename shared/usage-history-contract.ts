/**
 * 사용량 이력 API 계약(ADR 0.7 4절). 타입과 상수만 둔다 — 로직은 두지 않는다.
 *
 * 응답에는 제공자 원문(rawText)이 들어가지 않는다. Worker가 서버에서 파싱해
 * 표본(시각·상태·계열 값 목록)만 내린다. `values`의 두 뜻을 구분한다:
 * - `[]`  : 읽기에 성공했고 걸러 낸 뒤 남은 계열이 0개다(계열 소멸)
 * - `null`: 값을 모른다(수집 실패, 원문 없음, 형상 오류, 스캔 미완료)
 */
import type { UsageProvider, UsageStatus } from './usage-contract'

export const USAGE_HISTORY_PATH = '/api/usage-history'
/** 서버가 받는 limit 상한. Workers Paid 플랜 확정과 운영 측정(G0-B2) 뒤에만 올린다. */
export const USAGE_HISTORY_LIMIT_MAX = 100
/** 클라이언트가 보내는 기본 쪽 크기(G0-A2로 확정). */
export const USAGE_HISTORY_PAGE_LIMIT = 50
/** "충분히 쌓임" 판정에 필요한 ok 이벤트 수(10절). 변화가 드문 제공자도 열리도록 2건으로 완화. */
export const USAGE_HISTORY_MIN_OK_EVENTS = 2

/**
 * 표본 값의 의미 버전. 스캔 규칙(shared/usage-scan)이 바뀌어 같은 원문에서 다른 값이 나오게 되면 올린다.
 * - Worker는 응답의 `scanVersion`에 이 값을 넣는다.
 * - 클라이언트는 이 값과 다른 `scanVersion`의 응답을 병합하지 않고, 이 값과 다른 캐시 레코드를 버린다.
 * - shared/usage-scan은 이 파일을 import하지 않는다(순수성 규칙). 버전 상수는 여기 하나뿐이다.
 */
export const USAGE_HISTORY_SCAN_VERSION = 1

/** `from`·`until`의 형식: UTC 시각, 소수 초는 생략하거나 1~3자리. 달력상 없는 날짜는 형식이 맞아도 거절한다. */
export const USAGE_HISTORY_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/** `after`·`nextCursor`의 형식: `<runAt, ms 3자리 고정>_<usage_event.id>`. 클라이언트는 뜯지 않고 그대로 돌려보낸다. */
export const USAGE_HISTORY_CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([1-9]\d{0,18})$/
/** `limit`의 형식. 범위(1~USAGE_HISTORY_LIMIT_MAX)는 따로 확인한다. */
export const USAGE_HISTORY_LIMIT_RE = /^[1-9]\d{0,2}$/
/** `anchor` 쿼리 값 중 참으로 보는 유일한 문자열. */
export const USAGE_HISTORY_ANCHOR_ON = '1'

/**
 * `GET /api/usage-history/:provider`의 요청. 게이트웨이 포트와 픽스처 게이트웨이가 이 타입을 쓴다.
 * 쿼리 문자열로 옮길 때: 없는 필드는 보내지 않는다. `limit`은 항상 보낸다.
 * `anchor`는 true일 때만 `anchor=1`로 보내고 false·생략이면 파라미터를 붙이지 않는다.
 */
export interface UsageHistoryQuery {
  /** 이상(inclusive). `Date#toISOString()` 값. */
  from?: string
  /** 미만(exclusive). `from`과 함께 쓰면 `from`보다 뒤여야 한다. */
  until?: string
  /** 초과(exclusive) 커서. 직전 응답의 `nextCursor`를 그대로. */
  after?: string
  /** 1~USAGE_HISTORY_LIMIT_MAX의 정수. 클라이언트는 USAGE_HISTORY_PAGE_LIMIT을 쓴다. */
  limit: number
  /** true면 `from`이 있어야 한다. */
  anchor?: boolean
}

/**
 * 이력 경로가 낼 수 있는 오류 코드와 HTTP 상태. 본문은 `{ "error": <코드> }`.
 * 판정 순서(앞에서 걸리면 뒤는 보지 않는다):
 *   misconfigured → unauthorized | jwks_unavailable → not_found → method_not_allowed
 *   → invalid_query → storage_unavailable
 * `invalid_query`까지는 저장소를 읽지 않는다. 요약 경로(`/api/usage-history`)는 쿼리를 보지 않으므로 `invalid_query`가 없다.
 */
export const USAGE_HISTORY_ERROR_STATUS = {
  misconfigured: 500,
  unauthorized: 401,
  jwks_unavailable: 503,
  not_found: 404,
  method_not_allowed: 405,
  invalid_query: 400,
  storage_unavailable: 503,
  internal_error: 500,
} as const
export type UsageHistoryErrorCode = keyof typeof USAGE_HISTORY_ERROR_STATUS
export interface UsageHistoryErrorBody {
  error: UsageHistoryErrorCode
}

/** 한 계열의 한 시점 값. 라벨·원문·기타 항목은 없다. */
export interface UsageHistoryValue {
  /** 계열 id. 카드 id와 같다. */
  id: string
  usedPercent: number
  resetsAt: string | null
  cycleSeconds: number | null
}

/** `usage_event` 한 행을 서버가 줄인 표본. */
export interface UsageHistorySample {
  /** usage_event.id(10진 문자열). 중복 제거 키. */
  id: string
  /** 수집기 실행 시각(run_at 컬럼). 정렬·커서에 쓴다. */
  runAt: string
  status: UsageStatus
  /** 값이 마지막으로 확인된 시각. ok면 runAt과 같고, 실패면 직전 성공 시각. */
  fetchedAt: string | null
  /** 그 봉투의 수집 주기(초). */
  intervalSec: number | null
  /** 배열 = 읽은 값(`[]`는 계열 소멸), null = 값 모름. */
  values: UsageHistoryValue[] | null
}

/** `GET /api/usage-history/:provider` 응답. 표본은 (runAt, id) 오름차순. */
export interface UsageHistoryPage {
  provider: UsageProvider
  /** 항상 USAGE_HISTORY_SCAN_VERSION. 클라이언트는 자기 상수와 다르면 이 응답을 쓰지 않는다. */
  scanVersion: number
  samples: UsageHistorySample[]
  /**
   * 요청에 `anchor=1`이 있을 때만 채운다: `from` 직전(run_at < from)의 마지막 `status = 'ok'` 표본.
   * 그런 행이 없거나 `anchor=1`이 아니면 null. 이 표본의 `values`는 null일 수도 있다(ok인데 읽지 못한 행).
   */
  anchor: UsageHistorySample | null
  /**
   * 다음 요청의 `after`.
   * - 표본이 1개 이상: 마지막 표본의 커서(`<runAt>_<id>`)
   * - 표본이 0개이고 요청에 `after`가 있었다: 그 `after`를 그대로
   * - 표본이 0개이고 요청에 `after`가 없었다: null
   * `anchor`는 이 값에 영향을 주지 않는다. `hasMore`가 참이면 null이 아니다.
   */
  nextCursor: string | null
  /** 표본 수 === 적용된 limit. 정확히 limit에서 끝난 경우 다음 쪽은 빈 배열이다. */
  hasMore: boolean
}

/** `GET /api/usage-history` 요약의 제공자 한 줄. okCount는 0~MIN_OK_EVENTS. */
export interface UsageHistorySummaryEntry {
  provider: UsageProvider
  okCount: number
  firstOkAt: string | null
  lastOkAt: string | null
}

/** `GET /api/usage-history` 응답. 제공자 6개가 고정 순서로 온다. */
export interface UsageHistorySummary {
  summary: UsageHistorySummaryEntry[]
}
