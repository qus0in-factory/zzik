import { elapsedPercent } from './elapsed'
import { usageLevelOf } from './level'
import { formatResetRemaining, isResetExpired } from './staleness'
import type { UsageOther, UsageWindow } from './types'

/** Grok·OpenCode·Ollama 뷰가 함께 쓰는 순수 조각. 형상 판정은 각 뷰 파일에 둔다. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 유한한 숫자를 0..100으로 자른다. 숫자가 아니거나 유한하지 않으면 null. 정밀도는 유지한다. */
export function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

/** 해석 가능한 ISO 시각이면 그대로, 아니면 null. */
export function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

/** 두 시각의 간격(초). 둘 다 해석되고 end가 start보다 뒤일 때만. 월 길이를 가정하지 않는다. */
export function secondsBetween(start: unknown, end: unknown): number | null {
  const from = isoOrNull(start)
  const to = isoOrNull(end)
  if (from === null || to === null) return null
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000
  return seconds > 0 ? seconds : null
}

export function makeWindow(
  input: { id: string; label: string; unknown?: boolean; usedPercent: number; resetsAt: string | null; cycleSeconds: number | null },
  now: Date,
): UsageWindow {
  return {
    id: input.id,
    label: input.label,
    ...(input.unknown ? { unknown: true } : {}),
    usedPercent: input.usedPercent,
    resetsAt: input.resetsAt,
    elapsedPercent: elapsedPercent(input.resetsAt, input.cycleSeconds, now),
    expired: isResetExpired(input.resetsAt, now),
    status: usageLevelOf(input.usedPercent),
    resetText: formatResetRemaining(input.resetsAt, now),
  }
}

const text = (value: unknown): string => (typeof value === 'object' ? JSON.stringify(value) : String(value))

/** `others` 한 항목. 객체는 필드 목록, 나머지(배열 포함)는 문자열 한 줄. */
export function otherEntry(id: string, value: unknown, label = id): UsageOther {
  return {
    id,
    label,
    value: isRecord(value)
      ? { kind: 'object', fields: Object.entries(value).map(([key, field]) => ({ key, text: text(field) })) }
      : { kind: 'value', text: text(value) },
  }
}

/** 객체의 키 중 `skip`에 없는 것을 `others`로. `prefix`가 있으면 id를 `prefix.key`로 쓴다(가림 경로와 맞추기 위함). */
export function otherEntries(record: Record<string, unknown>, skip: readonly string[], prefix = ''): UsageOther[] {
  return Object.entries(record)
    .filter(([key]) => !skip.includes(key))
    .map(([key, value]) => otherEntry(prefix + key, value, key))
}
