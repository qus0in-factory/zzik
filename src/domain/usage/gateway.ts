import type { RawUsage } from './types'

/**
 * 프론트 사용량 포트(ADR 0.2 D11, 스택 부록 A4).
 * 성공 데이터는 raw 응답과 수집 메타(봉투의 rawText 제거분)를 그대로 싣는다.
 * 가공은 app의 load-usage가 now와 함께 한다.
 */

export type UsageGatewayFailureReason = 'session_expired' | 'api_error' | 'network_error'

export type UsageGatewayResult =
  | { ok: true; usage: RawUsage | null; collection: import('../../../shared/usage-contract').UsageCollectionMeta | null; rawText: string | null }
  | { ok: false; reason: UsageGatewayFailureReason; message: string | null }

/** queryFn이 되돌려 캐시에 두는 성공 데이터. */
export type UsageGatewaySuccess = Extract<UsageGatewayResult, { ok: true }>

export interface UsageGateway {
  fetchUsage(): Promise<UsageGatewayResult>
}

/** 시계 포트. 테스트는 고정 시각을 돌려주는 가짜를 주입한다(전역 Date 대체 금지). */
export interface UsageClock {
  nowIso(): string
}

/** 타이머 포트. schedule은 1회성 실행이고 되돌림 함수를 돌려준다. 30초 now 틱에 쓴다. */
export interface UsageScheduler {
  schedule(ms: number, run: () => void): () => void
}
