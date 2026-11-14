import { extraSpendOf } from './extra-spend'
import { visibleUsageReport } from './visible'
import { elapsedPercent, cycleSeconds } from './elapsed'
import { classifyUsageKeys, isKnownMetricId, WINDOW_IDS } from './classify'
import { aggregateUsageLevel, usageLevelOf } from './level'
import { usageLabelFor } from './labels'
import { formatResetRemaining, isResetExpired } from './staleness'
import type { RawUsage, UsageIssue, UsageMetric, UsageOther, UsageReport, UsageWindow } from './types'

export type { RawUsage, UsageReport, UsageMetric, UsageWindow, UsageOther, UsageIssue } from './types'

export interface BuildUsageViewOptions {
  now?: Date
}

import { METRIC_ORDER as KNOWN_METRIC_ORDER } from '../../../shared/usage-scan/claude.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** raw 최상위 데이터를 화면용 뷰 모델로 조립한다 (D9, 시나리오 C1~C13). now는 주입받는다. */
export function buildUsageView(raw: unknown, options: BuildUsageViewOptions = {}): UsageReport {
  const now = options.now ?? new Date()
  const invalidShape = { status: 'unknown' as const, windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' as const, key: undefined }], raw: null }

  if (!isRecord(raw)) return invalidShape
  const data = raw as RawUsage

  const { entries, issues } = classifyUsageKeys(data)

  const windows: UsageWindow[] = WINDOW_IDS.flatMap((windowId) =>
    entries
      .filter((item) => item.kind === 'window' && item.key === windowId)
      .map((item) => {
        const usedPercent = item.utilization
        return {
          id: item.key,
          label: usageLabelFor(item.key).label,
          usedPercent,
          elapsedPercent: elapsedPercent(item.resetsAt, cycleSeconds(item.key), now),
          cycleSeconds: cycleSeconds(item.key),
          resetsAt: item.resetsAt,
          expired: isResetExpired(item.resetsAt, now),
          status: usageLevelOf(usedPercent),
          resetText: formatResetRemaining(item.resetsAt, now),
        }
      }),
  )

  const unknownIds = entries
    .filter((item) => item.kind === 'metric' && !isKnownMetricId(item.key))
    .map((item) => item.key)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const orderedMetricIds = [...KNOWN_METRIC_ORDER, ...unknownIds]

  const metrics: UsageMetric[] = orderedMetricIds.flatMap((id) =>
    entries
      .filter((item) => item.kind === 'metric' && item.key === id)
      .map((item) => {
        const usedPercent = item.utilization
        return {
          id: item.key,
          label: usageLabelFor(item.key).label,
          unknown: !isKnownMetricId(item.key),
          usedPercent,
          elapsedPercent: elapsedPercent(item.resetsAt, cycleSeconds(item.key), now),
          cycleSeconds: cycleSeconds(item.key),
          resetsAt: item.resetsAt,
          expired: isResetExpired(item.resetsAt, now),
          status: usageLevelOf(usedPercent),
          resetText: formatResetRemaining(item.resetsAt, now),
        }
      }),
  )

  // 기타 항목은 raw 키 순서를 그대로 유지한다.
  const others: UsageOther[] = entries
    .filter((item) => item.kind === 'other')
    .map((item) => {
      const value = item.otherValue ?? { kind: 'value' as const, text: String(item.utilization ?? '') }
      return {
        id: item.key,
        label: item.key,
        value,
      }
    })

  const status = aggregateUsageLevel([...windows, ...metrics].map((item) => ({ status: item.status, expired: item.expired })))

  return visibleUsageReport({ status, windows, metrics, others, issues, raw: data, extraSpend: extraSpendOf(data.extra_usage) })
}
