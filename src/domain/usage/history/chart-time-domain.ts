import { elapsedPercent } from '../elapsed'

export const MIN_CHART_SPAN_MS = 3 * 60_000

/** 선택 기간은 조회 필터다. 축은 제공자의 첫 수집~현재, 단 최소 3분이며 미래를 포함하지 않는다. */
export function chartTimeDomain(times: readonly number[], windowFrom: number, nowMs: number, anchorTime: number | null = null): { from: number; to: number } {
  let first = nowMs
  for (const t of times) if (Number.isFinite(t) && t >= windowFrom && t <= nowMs) first = Math.min(first, t)
  if (anchorTime !== null && Number.isFinite(anchorTime) && anchorTime >= windowFrom && anchorTime <= nowMs) first = Math.min(first, anchorTime)
  return { from: Math.min(first, nowMs - MIN_CHART_SPAN_MS), to: nowMs }
}

export interface PaceWindow {
  resetsAt: string | null
  cycleSeconds?: number | null
}

/** 현재 창 시작 시각(epoch ms). 유효하지 않으면 null. */
export function paceWindowStart(window: PaceWindow): number | null {
  const seconds = window.cycleSeconds ?? null
  if (!window.resetsAt || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  const reset = Date.parse(window.resetsAt)
  return Number.isFinite(reset) ? reset - seconds * 1000 : null
}

/** 현재 창 시작 이후 구간에만 기존 elapsedPercent를 돌려주고, 창 시작 이전은 null(값 없음·선 끊김)이다. */
export function paceValueAt(window: PaceWindow, t: number): number | null {
  const start = paceWindowStart(window)
  if (start === null || !Number.isFinite(t) || t < start) return null
  return elapsedPercent(window.resetsAt, window.cycleSeconds ?? null, new Date(t))
}

/** 기존 기간 경과율 정책을 그대로 쓴다. 현재 창 시작 시각 이후 구간([max(from, start), to])에만 그리며 그 이전은 그리지 않는다. */
export function pacePoints(window: PaceWindow, from: number, to: number): { t: number; p: number }[] | null {
  const start = paceWindowStart(window)
  if (start === null || to < from) return null
  const paceFrom = Math.max(from, start)
  if (to < paceFrom) return null
  const seconds = window.cycleSeconds ?? null
  const reset = Date.parse(window.resetsAt!)
  const times = [paceFrom, to, reset].filter((t) => t >= paceFrom && t <= to)
  return [...new Set(times)].sort((a, b) => a - b).map((t) => ({ t, p: elapsedPercent(window.resetsAt, seconds, new Date(t))! }))
}
