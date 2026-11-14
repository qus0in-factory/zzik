/**
 * 프론트 이력 계층의 타입(ADR 0.7 6.2·9절). T0에서는 타입만 동결한다 — 구현은 T2에서 한다.
 */
import type { UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { UsageProvider } from '../../../../shared/usage-contract'

/** 차트 범위 탭(8.2·9절). 기본값은 '7d'. */
export type ChartRange = '24h' | '7d' | '30d'

/** 이력 응답 디코드가 내는 `api_error`의 message. 서버가 보내는 코드가 아니다. */
export type HistoryDecodeErrorCode = 'invalid_response' | 'scan_version_mismatch'

/**
 * IndexedDB `zzik`/`usage-history` 레코드(6.2절).
 * 불변식 I1~I6은 구현(T2)과 테스트의 기준이다.
 */
export interface HistoryCacheRecord {
  v: 1
  scanVersion: number
  provider: UsageProvider
  /** 보유 구간의 시작 시각(이상). */
  coveredFrom: string | null
  /** 보유 구간의 끝(마지막 반영 표본의 커서). */
  cursor: string | null
  /** coveredFrom 직전의 마지막 ok 표본. */
  anchor: UsageHistorySample | null
  /** (runAt, id) 오름차순, id 유일. */
  samples: UsageHistorySample[]
  /** 카드에서 본 마지막 라벨. */
  labels: Record<string, string>
  /** 계열 첫 등장 순, 추가만(색 슬롯). */
  seriesOrder: string[]
  /** 마지막 동기화 때의 스냅샷 runAt. */
  syncedThroughRunAt: string | null
  syncedAt: string
}
