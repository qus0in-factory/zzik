import type { RawUsage } from './types'

/**
 * 0.2.1 목 단계의 프론트 포트(ADR 0.2 D11 도메인 배정).
 * 0.2에서 `http-usage-gateway`가 이 포트를 구현해 교체한다.
 */

export type UsageGatewayFailureReason = 'session_expired' | 'api_error' | 'network_error'

export type UsageGatewayResult =
  | { ok: true; usage: RawUsage }
  | { ok: false; reason: UsageGatewayFailureReason; message: string | null }

export interface UsageGateway {
  fetchUsage(): Promise<UsageGatewayResult>
}

/** 시계 포트. 테스트는 고정 시각을 돌려주는 가짜를 주입한다(전역 Date 대체 금지). */
export interface UsageClock {
  nowIso(): string
}

/** 타이머 포트. schedule은 1회성 실행이고 되돌림 함수를 돌려준다. */
export interface UsageScheduler {
  schedule(ms: number, run: () => void): () => void
}

/** 탭 가시성 포트. 폴러가 화면이 보일 때만 호출하게 한다. */
export interface UsageVisibility {
  isVisible(): boolean
  subscribe(listener: () => void): () => void
}
