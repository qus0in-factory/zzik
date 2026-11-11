import type { UsageReport } from '@domain/usage/types'
import type { UsageUiStatus } from '@app/usage/useUsage'

/** 수집 판정(normal/warn/limit/unknown)의 표시 문구. */
export const READY_BADGE: Record<'normal' | 'warn' | 'limit' | 'unknown', string> = {
  normal: '정상',
  warn: '주의',
  limit: '한도 도달',
  unknown: '데이터 없음',
}

/** 화면 상태 + 보고서 → 배지·칩에 쓰는 짧은 문구. 판정은 하지 않고 매핑만 한다. */
export function usageStatusLabel(status: UsageUiStatus, report: UsageReport | null): string {
  if (status === 'loading') return '불러오는 중'
  if (status === 'stale') return '오래된 데이터'
  if (status === 'error') return '오류'
  return report === null ? '데이터 없음' : READY_BADGE[report.status]
}

/**
 * 수집 상태별 표시 문구(ADR 0.3 v2 D4·D9 표의 안내). 판정 없이 매핑만 한다.
 * auth_rejected는 token_expired와 문구가 분리된다(v2 H2).
 */
export const COLLECTION_STATUS_LABEL: Record<string, string> = {
  ok: '정상',
  rate_limited: '요청 제한',
  token_expired: '인증 필요',
  auth_required: '인증 필요',
  auth_rejected: '인증 거부',
  no_credentials: '자격 증명 없음',
  upstream_error: '수집 오류',
  network_error: '수집 오류',
}
