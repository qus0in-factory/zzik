import type { UsageGateway, UsageGatewayFailureReason } from '@domain/usage/gateway'
import { buildUsageView } from '@domain/usage/view'
import type { UsageReport } from '@domain/usage/view'

export type UsageLoadResult =
  | { ok: true; report: UsageReport }
  | { ok: false; reason: UsageGatewayFailureReason; message: string | null }

export interface LoadUsageOptions {
  now?: Date
}

/** 게이트웨이 포트를 호출하고 raw를 domain의 뷰 모델로 바꾼다(ADR 0.2 D11). */
export function loadUsage(gateway: UsageGateway, options: LoadUsageOptions = {}): Promise<UsageLoadResult> {
  return gateway.fetchUsage().then((result) => {
    if (result.ok) {
      return { ok: true as const, report: buildUsageView(result.usage, options.now ? { now: options.now } : {}) }
    }
    return { ok: false as const, reason: result.reason, message: result.message }
  })
}

/** 실패 이유의 기본 안내 문구. 게이트웨이가 준 message가 없을 때 쓴다. */
export function describeGatewayFailure(reason: UsageGatewayFailureReason): string {
  if (reason === 'session_expired') return 'Access 세션이 만료되었습니다. 페이지를 새로 고친 뒤 다시 로그인해 주세요.'
  if (reason === 'network_error') return '네트워크에 연결할 수 없습니다.'
  return '사용량을 불러오지 못했습니다.'
}
