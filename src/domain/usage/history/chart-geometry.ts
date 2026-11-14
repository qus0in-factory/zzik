/**
 * 차트 좌표·눈금·최근접 탐색·슬롯 배정(ADR 0.7 8·11절). 전부 순수 함수다.
 * 선 path 생성은 uPlot이 맡으므로 두지 않는다 — 리셋·결측으로 끊긴 구간은
 * ChartView.stops의 `percent: null`로 표현해 uPlot data의 null 간격으로 옮긴다.
 */
export interface ChartPlot {
  x: number
  y: number
  width: number
  height: number
}

/** 왼쪽은 y 눈금, 오른쪽은 여백, 아래는 x 눈금 자리. */
const PADDING = { top: 10, right: 46, bottom: 24, left: 34 } as const

export const CHART_Y_TICKS: readonly number[] = [0, 25, 50, 75, 100]
/** 슬롯 1~8의 기본 테마 무늬(ADR 11절 ④). 1~3은 실선. */
export const CHART_SLOT_DASH: readonly (string | null)[] = [null, null, null, '6 3', '2 3', '8 3 2 3', '1 3', '10 3']
/** 9번째 이후(슬롯 0)의 중립 회색 파선. */
export const CHART_OVERFLOW_DASH = '4 4'

export function chartPlot(width: number, height: number): ChartPlot {
  return {
    x: PADDING.left,
    y: PADDING.top,
    width: Math.max(1, width - PADDING.left - PADDING.right),
    height: Math.max(1, height - PADDING.top - PADDING.bottom),
  }
}

/** 0% = 아래, 100% = 위. 100을 넘는 값·음수는 축에 맞춰 자른다(툴팁 값은 자르지 않는다). */
export function yForPercent(percent: number, plot: ChartPlot): number {
  const clamped = Math.max(0, Math.min(100, percent))
  return plot.y + plot.height * (1 - clamped / 100)
}

export function xForTime(t: number, from: number, to: number, plot: ChartPlot): number {
  const span = Math.max(1, to - from)
  return plot.x + plot.width * ((t - from) / span)
}

export function yTickPositions(plot: ChartPlot): number[] {
  return CHART_Y_TICKS.map((value) => plot.y + plot.height * (1 - value / 100))
}

export function xTickPositions(plot: ChartPlot, count = 5): number[] {
  if (count < 2) return [plot.x]
  return Array.from({ length: count }, (_, i) => plot.x + (plot.width * i) / (count - 1))
}

/** xs는 오름차순. 거리가 같으면 뒤쪽(큰 인덱스)을 고른다. 비면 -1. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1
  let best = 0
  let bestDistance = Math.abs(xs[0] - x)
  for (let i = 1; i < xs.length; i += 1) {
    const distance = Math.abs(xs[i] - x)
    if (distance <= bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}

/** seriesOrder 순번(0부터) → 팔레트 슬롯. 9번째부터는 0(중립 회색). */
export function slotForOrdinal(ordinal: number): number {
  return ordinal < 8 ? ordinal + 1 : 0
}

export function dashForSlot(slot: number): string | null {
  return slot === 0 ? CHART_OVERFLOW_DASH : CHART_SLOT_DASH[slot - 1]
}
