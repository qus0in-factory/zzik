import { readOllamaIncluded } from '../../../shared/usage-scan/ollama.ts'
import { aggregateUsageLevel } from './level'
import { isRecord, makeWindow, otherEntries } from './provider-view-parts'
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
    const value = readOllamaIncluded(included)
    if (value === null) {
      issues.push({ code: 'invalid_utilization', key: 'included' })
    } else {
      windows.push(
        makeWindow(
          {
            ...value,
            label: t('label.credit.included'),
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
