/** OpenRouter 점유율 트리맵의 squarified 배치(순수 함수). 좌표는 0..width/0..height 비율 단위다. */
export interface TreemapItem {
  id: string
  value: number
}

export interface TreemapRect {
  id: string
  value: number
  x: number
  y: number
  width: number
  height: number
}

/** --brand(#057873) 계열의 5단계 명도. 0~2는 흰 글자, 3~4는 검정 글자로 4.5:1 이상이다. */
export const TREEMAP_STEPS = [
  { background: '#024a46', foreground: '#ffffff' },
  { background: '#035c58', foreground: '#ffffff' },
  { background: '#057873', foreground: '#ffffff' },
  { background: '#4fa8a2', foreground: '#0a0a0a' },
  { background: '#9fd4d0', foreground: '#0a0a0a' },
] as const

/** 점유율을 최대값 대비 5단계 명도로 매핑한다. 작은 점유율일수록 밝다. */
export function treemapStep(value: number, maxValue: number): number {
  if (maxValue <= 0) return TREEMAP_STEPS.length - 1
  const ratio = value / maxValue
  if (ratio >= 0.65) return 0
  if (ratio >= 0.35) return 1
  if (ratio >= 0.18) return 2
  if (ratio >= 0.07) return 3
  return 4
}

function worstRatio(row: readonly number[], side: number): number {
  const sum = row.reduce((total, area) => total + area, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  const side2 = side * side
  const sum2 = sum * sum
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min))
}

/** 면적이 큰 항목부터 squarified 행을 채워 사각형을 만든다. value<=0 항목은 제외한다. */
export function squarify(items: readonly TreemapItem[], width: number, height: number): TreemapRect[] {
  if (width <= 0 || height <= 0) return []
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  if (positive.length === 0) return []
  const totalValue = positive.reduce((total, item) => total + item.value, 0)
  const totalArea = width * height
  let remaining: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width, height }
  let rest = positive.map((item) => ({ ...item, area: (item.value / totalValue) * totalArea }))
  const rects: TreemapRect[] = []

  while (rest.length > 0) {
    const side = Math.min(remaining.width, remaining.height)
    let row = [rest[0]!]
    let index = 1
    while (index < rest.length) {
      const next = [...row, rest[index]!]
      if (worstRatio(next.map((item) => item.area), side) <= worstRatio(row.map((item) => item.area), side)) {
        row = next
        index += 1
      } else break
    }
    const rowArea = row.reduce((total, item) => total + item.area, 0)
    if (remaining.width >= remaining.height) {
      const rowWidth = rowArea / remaining.height
      let y = remaining.y
      for (const item of row) {
        const itemHeight = item.area / rowWidth
        rects.push({ id: item.id, value: item.value, x: remaining.x, y, width: rowWidth, height: itemHeight })
        y += itemHeight
      }
      remaining = { x: remaining.x + rowWidth, y: remaining.y, width: remaining.width - rowWidth, height: remaining.height }
    } else {
      const rowHeight = rowArea / remaining.width
      let x = remaining.x
      for (const item of row) {
        const itemWidth = item.area / rowHeight
        rects.push({ id: item.id, value: item.value, x, y: remaining.y, width: itemWidth, height: rowHeight })
        x += itemWidth
      }
      remaining = { x: remaining.x, y: remaining.y + rowHeight, width: remaining.width, height: remaining.height - rowHeight }
    }
    rest = rest.slice(row.length)
  }
  return rects
}

/** 칸이 작으면 라벨을 숨기고 title·aria-label·sr-only 목록으로 대체한다. */
export function shouldShowTreemapLabel(rect: Pick<TreemapRect, 'width' | 'height'>): boolean {
  return rect.width * rect.height >= 240
}
