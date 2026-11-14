export type RawUsageEntry = { utilization?: number | null; resets_at?: string | null } | null
export type RawUsage = Record<string, RawUsageEntry>

export type UsageLevel = 'normal' | 'warn' | 'limit' | 'unknown'

export interface UsageWindow {
  id: string
  label: string
  /** 라벨이 실측으로 확인되지 않은 창(미확인 배지) */
  unknown?: boolean
  elapsedPercent: number | null
  /** 한도 주기(초). 응답·표에서 알 수 없으면 null(요약 칩이 월·주 한도를 고를 때 쓴다) */
  cycleSeconds?: number | null
  usedPercent: number | null
  resetsAt: string | null
  expired: boolean
  status: UsageLevel
  /** 리셋까지 남은 시간의 표시 문구(ui는 판정하지 않고 그대로 그린다) */
  resetText: string
}

export interface UsageMetric {
  id: string
  label: string
  unknown: boolean
  elapsedPercent: number | null
  usedPercent: number | null
  resetsAt: string | null
  expired: boolean
  status: UsageLevel
  /** 리셋까지 남은 시간의 표시 문구(ui는 판정하지 않고 그대로 그린다) */
  resetText: string
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
  raw: Record<string, unknown> | null
}
