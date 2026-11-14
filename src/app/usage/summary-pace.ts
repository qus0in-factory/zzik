import type { UsageProvider } from '@domain/usage/providers'
import type { UsageWindow } from '@domain/usage/types'

const DAY = 86_400

/** 제공자 요약 칩에 쓰는 한도 하나: 사용률과 예상 사용률(기간 경과율). */
export interface SummaryPace {
  unit: 'month' | 'week'
  usedPercent: number
  elapsedPercent: number
  /** 사용률이 예상을 넘었는가(경고 톤) */
  overPace: boolean
}

/** 주기(초)로 월(28~31일)·주(7일) 판정. 그 외(5시간 등)는 null. */
function unitOf(window: UsageWindow): 'month' | 'week' | null {
  const seconds = window.cycleSeconds
  if (seconds === null || seconds === undefined) return null
  if (seconds >= 28 * DAY && seconds <= 31 * DAY) return 'month'
  if (seconds === 7 * DAY) return 'week'
  return null
}

/** Antigravity는 Gemini 모델 창(bucketId `gemini-*`)만 따른다. Claude·GPT(`3p-*`)·Argon 등 다른 모델 창은 칩 선택에서 제외한다. */
function eligible(window: UsageWindow, provider: UsageProvider | undefined): boolean {
  return provider !== 'antigravity' || window.id.startsWith('gemini-')
}

/**
 * 가장 긴 주기 한도 하나를 고른다: 월간이 있으면 월간, 없으면 주간. 같은 주기가 여럿이면 사용률이 가장 높은 것.
 * 월·주 한도가 없거나 사용률·경과율을 알 수 없으면 null(칩 생략). 월간의 경과율이 없다고 주간으로 대신하지 않는다.
 */
export function summaryPaceOf(windows: readonly UsageWindow[], provider?: UsageProvider): SummaryPace | null {
  const tagged = windows.flatMap((window) => {
    if (!eligible(window, provider)) return []
    const unit = unitOf(window)
    return unit === null ? [] : [{ window, unit }]
  })
  const pool = tagged.some((item) => item.unit === 'month') ? tagged.filter((item) => item.unit === 'month') : tagged
  const best = pool.reduce<(typeof pool)[number] | null>((top, item) => (top === null || (item.window.usedPercent ?? -1) > (top.window.usedPercent ?? -1) ? item : top), null)
  if (best === null) return null
  const { usedPercent, elapsedPercent } = best.window
  if (usedPercent === null || elapsedPercent === null) return null
  return { unit: best.unit, usedPercent, elapsedPercent, overPace: usedPercent > elapsedPercent }
}
