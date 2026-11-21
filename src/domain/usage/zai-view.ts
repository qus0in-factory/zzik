import { readZaiLimits, zaiLimits } from '../../../shared/usage-scan/zai.ts'
import { aggregateUsageLevel } from './level'
import { isRecord, makeWindow, otherEntries } from './provider-view-parts'
import { visibleUsageReport } from './visible'
import type { UsageIssue, UsageOther, UsageReport } from './types'
import { t } from '@shared/messages'

/** 카드 라벨만 둔다. 값·주기·순서는 shared/usage-scan이 해석한다. */
const LABELS: Record<string, string> = {
  five_hour: t('label.window.fiveHour'),
  weekly: t('label.window.weekly'),
}
/** 응답 성공 여부를 알리는 봉투 키. 사용량이 아니라 others에 올리지 않는다(원문에는 남는다). */
const RESPONSE_STATUS_KEYS = ['data', 'code', 'msg', 'success']

const EMPTY: UsageReport = { status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: null }

/**
 * Z.AI(GLM Coding Plan) 한도 응답 → 5시간·주간 카드 2장. `data.limits`가 없으면 형상 오류로 드러낸다.
 * 읽지 않는 한도(TIME_LIMIT 등)는 카드도 문제도 만들지 않고, `data.level`(요금제) 같은 나머지 키는 others로 보존한다.
 */
export function buildZaiUsageView(raw: unknown, options: { now: Date }): UsageReport {
  if (!isRecord(raw)) return EMPTY
  const limits = zaiLimits(raw)
  if (limits === null) return { ...EMPTY, raw }

  const scan = readZaiLimits(limits)
  const issues: UsageIssue[] = scan.invalid.map((index) => ({ code: 'invalid_utilization', key: `data.limits[${index}]` }))
  const windows = scan.windows.map((item) =>
    makeWindow({ id: item.id, label: LABELS[item.id], usedPercent: item.usedPercent, resetsAt: item.resetsAt, cycleSeconds: item.cycleSeconds }, options.now),
  )
  const others: UsageOther[] = [
    ...otherEntries(raw['data'] as Record<string, unknown>, ['limits'], 'data.'),
    ...otherEntries(raw, RESPONSE_STATUS_KEYS),
  ]
  return visibleUsageReport({
    status: aggregateUsageLevel(windows.map((item) => ({ status: item.status, expired: item.expired }))),
    windows,
    metrics: [],
    others,
    issues,
    raw,
  })
}
