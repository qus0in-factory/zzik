import type { RawUsage, UsageIssue } from './types'

/**
 * raw 최상위 키를 창(primary/secondary)·항목(metric)·기타로 분류한다 (시나리오 C1~C3).
 */
export const WINDOW_IDS: readonly string[] = ['five_hour', 'seven_day']

export interface ClassifiedUsageEntry {
  kind: 'window' | 'metric' | 'other'
  key: string
  utilization: number | null
  resetsAt: string | null
  /** kind가 other일 때만 존재. 표시용으로 1단계 필드 또는 문자열화한 값 */
  otherValue?: UsageOtherValueValue
}

export type UsageOtherValueValue =
  | { kind: 'object'; fields: readonly { key: string; text: string }[] }
  | { kind: 'value'; text: string }

export interface ClassificationResult {
  entries: ClassifiedUsageEntry[]
  issues: UsageIssue[]
}

const KNOWN_METRIC_IDS: readonly string[] = [
  'seven_day_opus',
  'seven_day_sonnet',
  'seven_day_oauth_apps',
  'seven_day_cowork',
  'extra_usage',
]

export function isKnownMetricId(id: string): boolean {
  return KNOWN_METRIC_IDS.includes(id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** utilization의 값을 해석한다. 없으면 null, 숫자가 아니거나 음수·비유한이면 invalid */
function readUtilization(object: Record<string, unknown>): { value: number | null; invalid: boolean } {
  const raw = object['utilization']
  if (raw === undefined || raw === null) return { value: null, invalid: false }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return { value: raw, invalid: false }
  return { value: null, invalid: true }
}

function readResetsAt(object: Record<string, unknown>): string | null {
  const raw = object['resets_at']
  return typeof raw === 'string' ? raw : null
}

interface RawEntryFields {
  utilization: number | null
  resetsAt: string | null
  utilizationInvalid: boolean
}

function readRawEntry(object: Record<string, unknown>): RawEntryFields {
  const utilization = readUtilization(object)
  return { utilization: utilization.value, resetsAt: readResetsAt(object), utilizationInvalid: utilization.invalid }
}

function isLimitShape(fields: RawEntryFields): boolean {
  return fields.utilization !== null || fields.resetsAt !== null
}

function toStringText(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function toOtherValue(value: Record<string, unknown>): UsageOtherValueValue {
  const fields = Object.entries(value).map(([key, field]) => ({ key, text: toStringText(field) }))
  return { kind: 'object', fields }
}

function entry(
  kind: ClassifiedUsageEntry['kind'],
  key: string,
  fields: Partial<RawEntryFields>,
  otherValue?: UsageOtherValueValue,
): ClassifiedUsageEntry {
  return {
    kind,
    key,
    utilization: fields.utilization ?? null,
    resetsAt: fields.resetsAt ?? null,
    otherValue,
  }
}

export function classifyUsageKeys(raw: RawUsage): ClassificationResult {
  const entries: ClassifiedUsageEntry[] = []
  const issues: UsageIssue[] = []

  for (const [key, value] of Object.entries(raw)) {
    if (value === null) {
      entries.push(WINDOW_IDS.includes(key) ? entry('window', key, {}) : entry('metric', key, {}))
      continue
    }
    if (!isRecord(value)) {
      // 배열·원시값은 항목 형태가 아니다. 기타 항목으로 보여 주고 형식 문제를 기록한다.
      const text = Array.isArray(value) ? JSON.stringify(value) : String(value)
      entries.push(entry('other', key, {}, { kind: 'value', text }))
      issues.push({ code: 'invalid_entry', key })
      continue
    }
    const fields = readRawEntry(value)
    if (WINDOW_IDS.includes(key)) {
      entries.push(entry('window', key, fields))
      if (fields.utilizationInvalid) issues.push({ code: 'invalid_utilization', key })
      continue
    }
    if (isLimitShape(fields)) {
      entries.push(entry('metric', key, fields))
      if (fields.utilizationInvalid) issues.push({ code: 'invalid_utilization', key })
      continue
    }
    entries.push(entry('other', key, {}, toOtherValue(value)))
  }

  return { entries, issues }
}
