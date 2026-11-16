import type { UsageHistorySample } from '../../../../shared/usage-history-contract'
import { elapsedPercent } from '../elapsed'
import type { ChartRange, HistoryCacheRecord } from './types'

export const MIN_CHART_SPAN_MS = 3 * 60_000
export const RANGE_MS: Record<ChartRange, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
}

export function sampleTimeMs(sample: Pick<UsageHistorySample, 'runAt' | 'fetchedAt'>): number | null {
  const ms = Date.parse(sample.fetchedAt ?? sample.runAt)
  return Number.isFinite(ms) ? ms : null
}

/** 차트에 실제로 그릴 수 있는 성공 표본(비어 있지 않은 values 배열 보유)인지 판정한다. */
export function isDrawableSample(sample: Pick<UsageHistorySample, 'values'> | null | undefined): boolean {
  return sample !== null && sample !== undefined && sample.values !== null && sample.values.length > 0
}

/** 선택 범위 안에 그릴 수 있는 성공 표본이 있는가. 커버리지(백필 완료)와 스피너 판정은 별개다. */
export function hasDrawableSuccess(record: HistoryCacheRecord | null, range: ChartRange, nowMs: number): boolean {
  if (record === null) return false
  const from = nowMs - RANGE_MS[range]
  const inRange = (sample: UsageHistorySample): boolean => {
    const t = sampleTimeMs(sample)
    return t !== null && t >= from && t <= nowMs
  }
  return (
    record.samples.some((sample) => inRange(sample) && isDrawableSample(sample)) ||
    (record.anchor !== null && inRange(record.anchor) && isDrawableSample(record.anchor))
  )
}

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
