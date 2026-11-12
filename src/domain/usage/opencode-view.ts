import { aggregateUsageLevel } from './level'
import { clampPercent, isoOrNull, isRecord, makeWindow, otherEntries } from './provider-view-parts'
import { visibleUsageReport } from './visible'
import type { UsageIssue, UsageReport, UsageWindow } from './types'

/** 키 → [라벨, 주기(초)]. rolling 길이는 응답에 없어 추정하지 않고, monthly는 달 길이가 가변이라 null. 표의 순서가 화면 순서. */
const WINDOWS: ReadonlyArray<readonly [string, string, number | null]> = [
  ['rolling', '단기 한도', null],
  ['weekly', '주간 한도', 604_800],
  ['monthly', '월간 한도', null],
]

/** OpenCode(Zen Go) 사용량 → `usage`의 모든 키를 카드로. 모르는 키는 미확인 배지로 뒤에 알파벳순. */
export function buildOpencodeUsageView(raw: unknown, options: { now: Date }): UsageReport {
  const usage = isRecord(raw) ? raw['usage'] : null
  if (!isRecord(raw) || !isRecord(usage)) {
    return { status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: isRecord(raw) ? raw : null }
  }
  const issues: UsageIssue[] = []
  const known = WINDOWS.map(([key]) => key)
  const keys = [...known.filter((key) => key in usage), ...Object.keys(usage).filter((key) => !known.includes(key)).sort()]
  const windows: UsageWindow[] = []
  for (const key of keys) {
    const entry = usage[key]
    if (!isRecord(entry)) {
      issues.push({ code: 'invalid_entry', key: 'usage.' + key })
      continue
    }
    const percent = clampPercent(entry['percent'])
    if (percent === null) {
      issues.push({ code: 'invalid_utilization', key: 'usage.' + key })
      continue
    }
    const meta = WINDOWS.find(([id]) => id === key)
    windows.push(
      makeWindow(
        {
          id: key,
          label: meta?.[1] ?? key + ' 한도',
          unknown: meta === undefined,
          usedPercent: percent,
          resetsAt: isoOrNull(entry['resetsAt']),
          cycleSeconds: meta?.[2] ?? null,
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
