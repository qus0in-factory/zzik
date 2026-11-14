/** 한도 카드 제목 앞 아이콘의 종류(ui가 아이콘으로 옮긴다). */
export type CardKind = 'short' | 'weekly' | 'monthly' | 'model' | 'extra' | 'unknown'

const DAY = 86_400
const SHORT_MAX_SECONDS = 6 * 3600

/**
 * 한도 카드 종류 판정(순수 함수). 우선순위: 크레딧·추가 사용량 id → 모델별 metric → 주기(cycleSeconds) → id 패턴 → 모델별(metric) → 알 수 없음.
 * 주기는 짧음(6시간 이하)·주간(7일)·월간(28~31일)으로 나눈다.
 */
export function cardKindOf(item: { id: string; cycleSeconds?: number | null }, group: 'window' | 'metric'): CardKind {
  const id = item.id.toLowerCase()
  if (id === 'credits' || id === 'included' || id.startsWith('extra')) return 'extra'
  if (group === 'metric' && /^seven_day_/.test(id)) return 'model' // 모델별 한도는 주기(7일)보다 모델이 먼저
  const seconds = item.cycleSeconds
  if (seconds !== null && seconds !== undefined) {
    if (seconds <= SHORT_MAX_SECONDS) return 'short'
    if (seconds === 7 * DAY) return 'weekly'
    if (seconds >= 28 * DAY && seconds <= 31 * DAY) return 'monthly'
  }
  if (/(^|[_.-])(five_hour|5h|rolling)/.test(id)) return 'short'
  if (/(^|[_.-])(weekly|seven_day)$/.test(id)) return 'weekly'
  if (/(^|[_.-])monthly$/.test(id)) return 'monthly'
  return 'unknown'
}
