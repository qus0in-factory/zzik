export type BarLevel = 'neutral' | 'ok' | 'caution' | 'danger'

/** 색만으로 구분하지 않도록 각 단계의 안내 문구. */
export const BAR_LEVEL_TEXT: Record<BarLevel, string> = {
  neutral: '사용 없음',
  ok: '여유',
  caution: '주의',
  danger: '위험',
}

const DANGER_AT = 90
const CAUTION_AT = 70

/**
 * 사용률(used)과 리셋 주기 경과율(elapsed)로 막대 단계를 정한다.
 * - 0%는 중립. 90% 이상은 위험.
 * - 경과율이 있으면 used ≤ elapsed 는 여유, 그보다 크면 주의(페이스가 빠름).
 * - 경과율이 없으면 절대 임계(70 이상 주의, 90 이상 위험)만 쓴다.
 */
export function barLevelOf(used: number | null | undefined, elapsed: number | null | undefined): BarLevel {
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return 'neutral'
  if (used >= DANGER_AT) return 'danger'
  if (typeof elapsed === 'number' && Number.isFinite(elapsed)) return used <= elapsed ? 'ok' : 'caution'
  return used >= CAUTION_AT ? 'caution' : 'ok'
}
