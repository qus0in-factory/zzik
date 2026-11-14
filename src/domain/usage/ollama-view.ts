import { aggregateUsageLevel } from './level'
import { clampPercent, isoOrNull, isRecord, makeWindow, otherEntries, secondsBetween } from './provider-view-parts'
import { visibleUsageReport } from './visible'
import type { UsageIssue, UsageReport, UsageWindow } from './types'
import { t } from '@shared/messages'

/** Ollama 로컬 `/api/balance` → 포함 크레딧 카드 1장. `purchased`는 한도·리셋이 없어 카드 없이 others로 보존한다. */
export function buildOllamaUsageView(raw: unknown, options: { now: Date }): UsageReport {
  if (!isRecord(raw)) return { status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: null }
  const issues: UsageIssue[] = []
  const windows: UsageWindow[] = []
  const included = raw['included']
  if (!isRecord(included)) {
    issues.push({ code: 'invalid_entry', key: 'included' })
  } else {
    const allowance = included['allowance_usd']
    const balance = included['balance_usd']
    const valid = typeof allowance === 'number' && Number.isFinite(allowance) && allowance > 0 && typeof balance === 'number' && Number.isFinite(balance)
    if (!valid) {
      issues.push({ code: 'invalid_utilization', key: 'included' })
    } else {
      const period = isRecord(included['period']) ? included['period'] : {}
      windows.push(
        makeWindow(
          {
            id: 'included',
            label: t('label.credit.included'),
            usedPercent: clampPercent(((allowance - balance) / allowance) * 100) ?? 0,
            resetsAt: isoOrNull(period['until']),
            cycleSeconds: secondsBetween(period['from'], period['until']),
          },
          options.now,
        ),
      )
    }
  }
  return visibleUsageReport({
    status: aggregateUsageLevel(windows.map((item) => ({ status: item.status, expired: item.expired }))),
    windows,
    metrics: [],
    others: otherEntries(raw, ['included']),
    issues,
    raw,
  })
}
