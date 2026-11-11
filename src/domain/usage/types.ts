export type RawUsageEntry = { utilization?: number | null; resets_at?: string | null } | null
export type RawUsage = Record<string, RawUsageEntry>

export type UsageLevel = 'normal' | 'warn' | 'limit' | 'unknown'

export interface UsageWindow {
  id: string
  label: string
  usedPercent: number | null
  resetsAt: string | null
  expired: boolean
  status: UsageLevel
}

export interface UsageMetric {
  id: string
  label: string
  unknown: boolean
  usedPercent: number | null
  resetsAt: string | null
  expired: boolean
  status: UsageLevel
}

export type UsageOtherValue = { kind: 'object'; fields: readonly UsageOtherField[] } | { kind: 'value'; text: string }
export interface UsageOtherField {
  key: string
  text: string
}
export interface UsageOther {
  id: string
  label: string
  value: UsageOtherValue
}

export type UsageIssueCode = 'invalid_shape' | 'invalid_entry' | 'invalid_utilization'
export interface UsageIssue {
  code: UsageIssueCode
  key?: string
}

export interface UsageReport {
  status: UsageLevel
  windows: UsageWindow[]
  metrics: UsageMetric[]
  others: UsageOther[]
  issues: UsageIssue[]
  raw: RawUsage | null
}
