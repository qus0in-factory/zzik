import type { UsageIssue } from './types'

/**
 * raw 최상위 키를 창(primary/secondary)·항목(metric)·기타로 분류한다 (시나리오 C1~C3).
 */
export { WINDOW_IDS } from '../../../shared/usage-scan/claude.ts'
import { readClaudeLimit, scopedLimits } from '../../../shared/usage-scan/claude.ts'
import type { RawEntryFields } from '../../../shared/usage-scan/claude.ts'

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

import { METRIC_ORDER as KNOWN_METRIC_IDS } from '../../../shared/usage-scan/claude.ts'

export function isKnownMetricId(id: string): boolean {
  return KNOWN_METRIC_IDS.includes(id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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

export function classifyUsageKeys(raw: Record<string, unknown>): ClassificationResult {
  const entries: ClassifiedUsageEntry[] = []
  const issues: UsageIssue[] = []

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'limits' || key === 'weekly_scoped_shares' || key === 'extra_usage') continue
    const limit = readClaudeLimit(key, value)
    if (limit !== null) {
      entries.push(entry(limit.kind, key, limit))
      if (limit.utilizationInvalid) issues.push({ code: 'invalid_utilization', key })
      continue
    }
    if (!isRecord(value)) {
      // boolean 메타데이터는 유효한 기타 값이다. 나머지 배열·원시값은 형식 문제를 기록한다.
      const text = Array.isArray(value) ? JSON.stringify(value) : String(value)
      entries.push(entry('other', key, {}, { kind: 'value', text }))
      if (typeof value !== 'boolean') issues.push({ code: 'invalid_entry', key })
      continue
    }
    entries.push(entry('other', key, {}, toOtherValue(value)))
  }


  for (const item of scopedLimits(raw)) {
    const existing = entries.findIndex(entry => entry.key === item.key)
    if (existing !== -1) entries.splice(existing, 1)
    entries.push(entry('metric', item.key, item))
    if (item.utilizationInvalid) issues.push({code:'invalid_utilization',key:item.key})
  }
  return { entries, issues }
}
