import { elapsedPercent } from './elapsed'
import { usageLevelOf } from './level'
import { formatResetRemaining, isResetExpired } from './staleness'
import type { UsageOther, UsageWindow } from './types'

/** Grok·OpenCode·Ollama 뷰가 함께 쓰는 순수 조각. 형상 판정은 각 뷰 파일에 둔다. */

export { isRecord, clampPercent, isoOrNull, secondsBetween } from '../../../shared/usage-scan/parts.ts'
import { isRecord } from '../../../shared/usage-scan/parts.ts'

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
    cycleSeconds: input.cycleSeconds,
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
