import type { UsageProvider } from './usage-contract'

/** UTC 구간 [start, end). end < start면 자정을 넘기며 days는 시작 요일이다. */
export interface OffpeakWindow {
  start: string
  end: string
  days?: readonly number[]
}

export interface OffpeakEffect {
  target: string
  discountPercent: number
}

export interface OffpeakRule {
  windows: readonly OffpeakWindow[]
  source?: string
  verifiedAt?: string
  effect?: OffpeakEffect
}

export type OffpeakSchedule = Partial<Record<UsageProvider, OffpeakRule>>
export type OffpeakState =
  | { active: true; endsAt: string }
  | { active: false; startsAt: string }
export type OffpeakDecodeResult =
  | { ok: true; schedule: OffpeakSchedule }
  | { ok: false; reason: 'invalid_shape' | 'unknown_provider' | 'invalid_window'; path: string }

const DAY = 86_400_000
// providers.ts의 런타임 import 없이 순수하고 이식 가능한 검증을 유지한다.
const PROVIDERS: Record<UsageProvider, true> = {
  claude: true, codex: true, antigravity: true, opencode: true, grok: true, ollama: true, zai: true,
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function minutes(value: unknown, end: boolean): number | null {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  const total = h! * 60 + m!
  if (m! > 59 || h! > 24 || (h === 24 && m !== 0)) return null
  return end ? (total > 0 && total <= 1440 ? total : null) : (total < 1440 ? total : null)
}
function validWindow(value: unknown): value is OffpeakWindow {
  if (!record(value)) return false
  const start = minutes(value.start, false)
  const end = minutes(value.end, true)
  return start !== null && end !== null && start !== end &&
    (value.days === undefined || (Array.isArray(value.days) && value.days.length > 0 && value.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)))
}

function validEffect(value: unknown): value is OffpeakEffect {
  return record(value) && typeof value.target === 'string' && value.target.trim().length > 0 &&
    typeof value.discountPercent === 'number' && Number.isFinite(value.discountPercent) &&
    value.discountPercent > 0 && value.discountPercent <= 100
}

/** 잘못된 구간은 무시한다. 시계·I/O·문구 리소스에 의존하지 않는다. */
export function mergedOffpeakIntervals(rule: OffpeakRule | undefined, now: Date, beforeDays = 1, afterDays = 8): Array<{start:number;end:number}> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !record(rule) || !Array.isArray(rule.windows)) return []
  if (![beforeDays,afterDays].every(n => Number.isInteger(n) && n >= 0 && n <= 32)) return []
  const windows = rule.windows.filter(validWindow)
  if (!windows.length) return []
  const timestamp = now.getTime()
  const midnight = Math.floor(timestamp / DAY) * DAY
  const intervals: Array<{ start: number; end: number }> = []
  for (let offset = -beforeDays; offset <= afterDays; offset++) {
    const day = midnight + offset * DAY
    const weekday = new Date(day).getUTCDay()
    for (const window of windows) {
      if (window.days && !window.days.includes(weekday)) continue
      const start = minutes(window.start, false)!
      const end = minutes(window.end, true)!
      const interval = { start: day + start * 60_000, end: day + (end < start ? end + 1440 : end) * 60_000 }
      if (Number.isFinite(new Date(interval.start).getTime()) && Number.isFinite(new Date(interval.end).getTime())) intervals.push(interval)
    }
  }
  intervals.sort((a, b) => a.start - b.start)
  const merged: typeof intervals = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

/** 시계와 I/O에 의존하지 않는 UI 경계 조회. */
export function offpeakStateOf(rule: OffpeakRule | undefined, now: Date): OffpeakState | null {
  const timestamp = now instanceof Date ? now.getTime() : NaN
  const merged = mergedOffpeakIntervals(rule, now)
  for (const interval of merged) {
    if (interval.start <= timestamp && timestamp < interval.end) return { active: true, endsAt: new Date(interval.end).toISOString() }
    if (timestamp < interval.start) return { active: false, startsAt: new Date(interval.start).toISOString() }
  }
  return null
}

/** 주입할 JSON 전체를 검증하며 잘못된 항목의 경로를 반환한다. */
export function decodeOffpeakSchedule(value: unknown): OffpeakDecodeResult {
  const invalid = (path: string): OffpeakDecodeResult => ({ ok: false, reason: 'invalid_shape', path })
  if (!record(value)) return invalid('$')
  for (const [provider, rule] of Object.entries(value)) {
    if (!Object.hasOwn(PROVIDERS, provider)) return { ok: false, reason: 'unknown_provider', path: provider }
    if (!record(rule)) return invalid(provider)
    if (!Array.isArray(rule.windows)) return invalid(`${provider}.windows`)
    if (rule.effect !== undefined && !validEffect(rule.effect)) return invalid(`${provider}.effect`)
    if (rule.source !== undefined && typeof rule.source !== 'string') return invalid(`${provider}.source`)
    if (rule.verifiedAt !== undefined && (typeof rule.verifiedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(rule.verifiedAt) ||
      !Number.isFinite(Date.parse(rule.verifiedAt)) || new Date(rule.verifiedAt).toISOString().slice(0, 10) !== rule.verifiedAt)) return invalid(`${provider}.verifiedAt`)
    for (const [index, window] of rule.windows.entries()) {
      if (!validWindow(window)) return { ok: false, reason: 'invalid_window', path: `${provider}.windows[${index}]` }
    }
  }
  return { ok: true, schedule: value as OffpeakSchedule }
}
