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

/** 기존 기간 경과율 정책을 그대로 쓴다. 0/100 보정 경계를 포함해 직선 렌더가 주기 밖으로 새지 않는다. */
export function pacePoints(window: PaceWindow, from: number, to: number): { t: number; p: number }[] | null {
  const seconds = window.cycleSeconds ?? null
  const first = elapsedPercent(window.resetsAt, seconds, new Date(from))
  if (first === null || to < from) return null
  const reset = Date.parse(window.resetsAt!)
  const times = [from, to, reset - seconds! * 1000, reset]
    .filter(t => t >= from && t <= to)
  return [...new Set(times)].sort((a, b) => a - b).map(t => ({t, p: elapsedPercent(window.resetsAt, seconds, new Date(t))!}))
}
