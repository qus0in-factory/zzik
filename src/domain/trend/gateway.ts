import type { TrendSection, TrendSectionPayload } from '@shared/trend-contract'

export type TrendGatewayFailureReason = 'not_ready' | 'network_error' | 'api_error'

export type TrendGatewayResult =
  | { ok: true; value: TrendSectionPayload }
  | { ok: false; reason: TrendGatewayFailureReason; message: string | null }

/** 공개 트렌드 섹션 포트. ui는 이 타입만 알고 infra 구현은 조립 루트가 주입한다. */
export interface TrendGateway {
  fetchSection(section: TrendSection): Promise<TrendGatewayResult>
}
