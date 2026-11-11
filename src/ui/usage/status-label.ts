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
