/** 칩 드래그·키보드 이동의 순수 계산(DOM·포인터 이벤트와 무관). */

/** 끌고 있는 칩의 중심 x에 가장 가까운 칩의 인덱스. 칩이 없으면 0. */
export function nearestIndex(centers: readonly number[], x: number): number {
  let best = 0
  let bestDistance = Infinity
  centers.forEach((center, index) => {
    const distance = Math.abs(center - x)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

/** 다른 칩이 비켜 줄 방향: -1 왼쪽, 1 오른쪽, 0 제자리. origin은 끌고 있는 칩의 원래 인덱스, target은 놓일 인덱스. */
export function shiftDirection(index: number, origin: number, target: number): -1 | 0 | 1 {
  if (index === origin) return 0
  if (target > origin && index > origin && index <= target) return -1
  if (target < origin && index >= target && index < origin) return 1
  return 0
}

/** 키보드 이동: delta만큼, 보이는 칩 범위 안으로 보정. */
export function stepIndex(current: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, current + delta))
}
