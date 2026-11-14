import { scanAntigravityBuckets } from './antigravity-buckets'
import { antigravityCycleSeconds, antigravityLabel } from './antigravity-labels'
import { elapsedPercent } from './elapsed'
import { aggregateUsageLevel, usageLevelOf } from './level'
import { formatResetRemaining, isResetExpired } from './staleness'
import { visibleUsageReport } from './visible'
import type { UsageReport, UsageOther, UsageWindow } from './types'

export function buildAntigravityUsageView(raw: unknown, options: { now: Date }): UsageReport {
  const { buckets, issues } = scanAntigravityBuckets(raw)
  const data = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  const windows: UsageWindow[] = buckets.slice().sort((a, b) =>
    a.groupIndex - b.groupIndex
    || (antigravityCycleSeconds(a.window) ?? Infinity) - (antigravityCycleSeconds(b.window) ?? Infinity)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  ).map(bucket => ({
    id: bucket.id,
    ...antigravityLabel(bucket.groupLabel, bucket.window),
    usedPercent: bucket.usedPercent,
    resetsAt: bucket.resetsAt,
    elapsedPercent: elapsedPercent(bucket.resetsAt, antigravityCycleSeconds(bucket.window), options.now),
    cycleSeconds: antigravityCycleSeconds(bucket.window),
    expired: isResetExpired(bucket.resetsAt, options.now),
    status: usageLevelOf(bucket.usedPercent),
    resetText: formatResetRemaining(bucket.resetsAt, options.now),
  }))
  const text = (value: unknown): string => typeof value === 'object' ? JSON.stringify(value) : String(value)
  const others: UsageOther[] = Object.entries(data ?? {}).filter(([key]) => key !== 'groups').map(([key, value]) => ({
    id: key, label: key,
    value: value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { kind: 'object', fields: Object.entries(value).map(([key, field]) => ({ key, text: text(field) })) }
      : { kind: 'value', text: text(value) },
  }))
  return visibleUsageReport({
    status: aggregateUsageLevel(windows.map(item => ({ status: item.status, expired: item.expired }))),
    windows, metrics: [], others, issues, raw: data,
  })
}
