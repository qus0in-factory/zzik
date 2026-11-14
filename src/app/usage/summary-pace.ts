import type { UsageProvider } from '@domain/usage/providers'
import type { UsageWindow } from '@domain/usage/types'

import { summaryWindowOf, summaryUnitOf } from '@domain/usage/summary-window'

/** 제공자 요약 칩에 쓰는 한도 하나: 사용률과 예상 사용률(기간 경과율). */
export interface SummaryPace {
  unit: 'month' | 'week'
  usedPercent: number
  elapsedPercent: number
  /** 사용률이 예상을 넘었는가(경고 톤) */
  overPace: boolean
}

/**
 * 가장 긴 주기 한도 하나를 고른다: 월간이 있으면 월간, 없으면 주간. 같은 주기가 여럿이면 사용률이 가장 높은 것.
 * 월·주 한도가 없거나 사용률·경과율을 알 수 없으면 null(칩 생략). 월간의 경과율이 없다고 주간으로 대신하지 않는다.
 */
export function summaryPaceOf(windows: readonly UsageWindow[], provider?: UsageProvider): SummaryPace | null {
  const best = summaryWindowOf(windows, provider)
  if (best === null) return null
  const { usedPercent, elapsedPercent } = best
  if (usedPercent === null || elapsedPercent === null) return null
  return { unit: summaryUnitOf(best)!, usedPercent, elapsedPercent, overPace: usedPercent > elapsedPercent }
}
