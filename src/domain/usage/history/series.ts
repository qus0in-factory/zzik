/**
 * 계열 구간 만들기(ADR 0.7 5.3절). 입력은 `[기준 표본?, …표본]`(오름차순), 출력은 계열마다 끊기지 않는 구간 목록이다.
 * 시각은 전부 `fetchedAt`(없으면 runAt) 기준이고, 순수 함수라 시계를 읽지 않는다(꼬리 끝 시각은 입력으로 받는다).
 */
import type { UsageHistorySample, UsageHistoryValue } from '../../../../shared/usage-history-contract'

/** C1 만료 허용오차(5.3절, 12.2절). */
export const C1_TOLERANCE_MS = 60_000
/** C2 조기 리셋: G0-B3 전에는 꺼 둔다(12.2절). */
export const C2_EARLY_RESET_ENABLED = false
const C2_MIN_JUMP_MS = 10 * 60_000
const C2_CYCLE_FRACTION = 0.1
/** 이벤트가 없는 공백에 유지점을 끼우는 기준(`1.5 × intervalSec`). */
export const HOLD_GAP_FACTOR = 1.5
export const DEFAULT_INTERVAL_MS = 900_000

export interface SeriesPoint {
  /** epoch ms */
  t: number
  /** 사용률(자르지 않은 실제 값) */
  p: number
}
export interface SeriesSegment {
  points: SeriesPoint[]
}
export interface BuiltSeries {
  id: string
  segments: SeriesSegment[]
}
export interface SeriesInput {
  /** `from` 직전의 마지막 ok 표본(왼쪽 끝을 채운다) */
  anchor: UsageHistorySample | null
  samples: readonly UsageHistorySample[]
  /** 꼬리의 끝(스냅샷 fetchedAt, epoch ms). 모르면 null이고 꼬리는 늘리지 않는다 */
  tailEnd: number | null
}
export interface SeriesOptions {
  c2Enabled?: boolean
}

interface Meta {
  t: number
  p: number
  /** 리셋 시각(epoch ms) */
  r: number | null
  /** 주기(초) */
  c: number | null
}
interface OpenState {
  id: string
  segments: Meta[][]
  open: Meta[] | null
}

const parse = (iso: string | null): number | null => {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export function buildSeries(input: SeriesInput, options: SeriesOptions = {}): BuiltSeries[] {
  const c2 = options.c2Enabled ?? C2_EARLY_RESET_ENABLED
  const states = new Map<string, OpenState>()
  const order: string[] = []
  const items = input.anchor === null ? input.samples : [input.anchor, ...input.samples]

  const extend = (state: OpenState, to: number | null): void => {
    const open = state.open
    if (open === null || to === null) return
    const last = open[open.length - 1]
    if (to > last.t) open.push({ t: to, p: last.p, r: last.r, c: last.c })
  }
  const close = (state: OpenState): void => {
    if (state.open !== null) state.segments.push(state.open)
    state.open = null
  }
  const start = (state: OpenState, point: Meta): void => {
    state.open = [point]
  }
  const push = (state: OpenState, point: Meta): void => {
    const open = state.open
    if (open === null) return start(state, point)
    open.push(point)
    // 값과 리셋 시각이 같은 점이 이어지면 처음과 끝만 남긴다.
    const n = open.length
    if (n >= 3) {
      const [a, b, c] = [open[n - 3], open[n - 2], open[n - 1]]
      if (a.p === b.p && b.p === c.p && a.r === b.r && b.r === c.r) open.splice(n - 2, 1)
    }
  }

  for (const sample of items) {
    const t = parse(sample.fetchedAt) ?? parse(sample.runAt)
    if (t === null) continue
    const iv = (sample.intervalSec !== null && sample.intervalSec > 0 ? sample.intervalSec * 1000 : DEFAULT_INTERVAL_MS)

    if (sample.values === null) {
      // C4: 값 모름. 실패 상태면 값이 마지막으로 확인된 시각까지, ok인데 읽지 못했으면 한 주기 앞까지.
      const to = sample.status === 'ok' ? t - iv : parse(sample.fetchedAt)
      for (const state of states.values()) {
        extend(state, to)
        close(state)
      }
      continue
    }

    const present = new Map<string, UsageHistoryValue>()
    for (const value of sample.values) present.set(value.id, value)
    // C3: 이 표본에 없는 계열은 한 주기 앞까지 늘리고 닫는다.
    for (const state of states.values()) {
      if (!present.has(state.id) && state.open !== null) {
        extend(state, t - iv)
        close(state)
      }
    }
    for (const value of sample.values) {
      let state = states.get(value.id)
      if (state === undefined) {
        state = { id: value.id, segments: [], open: null }
        states.set(value.id, state)
        order.push(value.id)
      }
      const point: Meta = { t, p: value.usedPercent, r: parse(value.resetsAt), c: value.cycleSeconds }
      const open = state.open
      if (open === null) {
        start(state, point)
        continue
      }
      const previous = open[open.length - 1]
      const expired = previous.r !== null && point.t >= previous.r - C1_TOLERANCE_MS && point.p < previous.p
      const early =
        c2 && previous.r !== null && point.r !== null && point.c !== null && point.r - previous.r > Math.max(C2_MIN_JUMP_MS, point.c * 1000 * C2_CYCLE_FRACTION) && point.p < previous.p
      if (expired || early) {
        extend(state, previous.r === null ? null : Math.min(previous.r, point.t - iv))
        close(state)
        start(state, point)
        continue
      }
      if (point.t - previous.t > HOLD_GAP_FACTOR * iv && point.t - iv > previous.t) open.push({ t: point.t - iv, p: previous.p, r: previous.r, c: previous.c })
      push(state, point)
    }
  }

  // 꼬리: 열린 구간은 스냅샷 fetchedAt까지(리셋 시각이 있으면 그 전까지) 늘린다.
  for (const state of states.values()) {
    if (state.open !== null && input.tailEnd !== null) {
      const last = state.open[state.open.length - 1]
      extend(state, last.r === null ? input.tailEnd : Math.min(input.tailEnd, last.r))
    }
    close(state)
  }

  return order
    .map((id) => states.get(id) as OpenState)
    .filter((state) => state.segments.length > 0)
    .map((state) => ({ id: state.id, segments: state.segments.map((segment) => ({ points: segment.map((point) => ({ t: point.t, p: point.p })) })) }))
}
