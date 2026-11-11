import type { UsageCollectionMeta } from '../../../shared/usage-contract'
import type { UsageProvider } from './providers'

/**
 * 프론트 사용량 포트(ADR 0.2 D11, 0.3 D8).
 * 성공 데이터는 raw 응답과 수집 메타(봉투의 rawText 제거분)를 그대로 싣는다.
 * 제공자마다 독립 조회이므로 포트 시그니처가 provider를 받는다.
 */

export type UsageGatewayFailureReason = 'session_expired' | 'api_error' | 'network_error'

export type UsageGatewayResult =
  | {
      ok: true
      /** 제공자 원문(구조 미확인 포함) — 가공은 app/domain이 한다. */
      usage: Record<string, unknown> | null
      collection: UsageCollectionMeta | null
      rawText: string | null
    }
  | { ok: false; reason: UsageGatewayFailureReason; message: string | null }

/** queryFn이 되돌려 캐시에 두는 성공 데이터. */
export type UsageGatewaySuccess = Extract<UsageGatewayResult, { ok: true }>

export interface UsageGateway {
  fetchUsage(provider: UsageProvider): Promise<UsageGatewayResult>
}

/** 시계 포트. 테스트는 고정 시각을 돌려주는 가짜를 주입한다(전역 Date 대체 금지). */
export interface UsageClock {
  nowIso(): string
}

/** 타이머 포트. schedule은 1회성 실행이고 되돌림 함수를 돌려준다. 30초 now 틱에 쓴다. */
export interface UsageScheduler {
  schedule(ms: number, run: () => void): () => void
}
