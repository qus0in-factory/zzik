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
/** "충분히 쌓임" 판정에 필요한 ok 이벤트 수(10절). */
export const USAGE_HISTORY_MIN_OK_EVENTS = 4

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
  scanVersion: number
  samples: UsageHistorySample[]
  /** anchor=1일 때만: from 직전의 마지막 ok 표본. */
  anchor: UsageHistorySample | null
  /** 마지막 표본의 커서. 표본이 없으면 요청의 after 그대로. */
  nextCursor: string | null
  /** 표본 수 === limit */
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
