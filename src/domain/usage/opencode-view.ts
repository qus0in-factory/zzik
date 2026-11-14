import { readOpencodeWindow, opencodeKeys } from '../../../shared/usage-scan/opencode.ts'
import { aggregateUsageLevel } from './level'
import { isRecord, makeWindow, otherEntries } from './provider-view-parts'
import { visibleUsageReport } from './visible'
import type { UsageIssue, UsageReport, UsageWindow } from './types'
import { t } from '@shared/messages'

/** 카드 라벨만 둔다. 값·주기·순서는 shared/usage-scan이 해석한다. */
const WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ['rolling', t('label.window.short')],
  ['weekly', t('label.window.weekly')],
  ['monthly', t('label.window.monthly')],
]

/** OpenCode(Zen Go) 사용량 → `usage`의 모든 키를 카드로. 모르는 키는 미확인 배지로 뒤에 알파벳순. */
export function buildOpencodeUsageView(raw: unknown, options: { now: Date }): UsageReport {
  const usage = isRecord(raw) ? raw['usage'] : null
  if (!isRecord(raw) || !isRecord(usage)) {
    return { status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: isRecord(raw) ? raw : null }
  }
  const issues: UsageIssue[] = []
  const keys = opencodeKeys(usage)
  const windows: UsageWindow[] = []
  for (const key of keys) {
    const entry = usage[key]
    if (!isRecord(entry)) {
      issues.push({ code: 'invalid_entry', key: 'usage.' + key })
      continue
    }
    const value = readOpencodeWindow(key, entry)
    if (value === null) {
      issues.push({ code: 'invalid_utilization', key: 'usage.' + key })
      continue
    }
    const meta = WINDOWS.find(([id]) => id === key)
    windows.push(
      makeWindow(
        {
          ...value,
          label: meta?.[1] ?? t('label.window.named', { name: key }),
          unknown: meta === undefined,

        },
        options.now,
      ),
    )
  }
  return visibleUsageReport({
    status: aggregateUsageLevel(windows.map((item) => ({ status: item.status, expired: item.expired }))),
    windows,
    metrics: [],
    others: otherEntries(raw, ['usage']),
    issues,
    raw,
  })
}
