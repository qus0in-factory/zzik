import { readGrok } from '../../../shared/usage-scan/grok.ts'
import { aggregateUsageLevel } from './level'
import { isRecord, makeWindow, otherEntries } from './provider-view-parts'
import { visibleUsageReport } from './visible'
import type { UsageIssue, UsageOther, UsageReport, UsageWindow } from './types'
import { t } from '@shared/messages'

/** `config.currentPeriod.type` 표. 주기 계산은 start/end가 정본이라 라벨에만 쓴다. */
const PERIOD_LABELS: Record<string, string> = {
  USAGE_PERIOD_TYPE_WEEKLY: t('label.credit.weekly'),
  USAGE_PERIOD_TYPE_MONTHLY: t('label.credit.monthly'),
}
const UNKNOWN_LABEL = t('label.credit.usage')
/** 카드·시각으로 이미 쓰는 키(others에서 뺀다). */
const CONSUMED_CONFIG_KEYS = ['creditUsagePercent', 'billingPeriodStart', 'billingPeriodEnd']

const EMPTY: UsageReport = { status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: null }

/** Grok(xAI) 크레딧 응답 → 카드 1장. `config`가 없으면 루트로 대체하지 않고 형상 오류로 드러낸다. */
export function buildGrokUsageView(raw: unknown, options: { now: Date }): UsageReport {
  if (!isRecord(raw)) return EMPTY
  const config = raw['config']
  if (!isRecord(config)) return { ...EMPTY, raw }

  const issues: UsageIssue[] = []
  const windows: UsageWindow[] = []
  const value = readGrok(config)
  if (value === null) {
    issues.push({ code: 'invalid_utilization', key: 'config.creditUsagePercent' })
  } else {
    const period = isRecord(config['currentPeriod']) ? config['currentPeriod'] : {}
    const type = typeof period['type'] === 'string' ? period['type'] : null
    const known = type !== null && Object.hasOwn(PERIOD_LABELS, type)
    windows.push(
      makeWindow(
        {
          ...value,
          label: known ? PERIOD_LABELS[type] : UNKNOWN_LABEL,
          unknown: !known,
        },
        options.now,
      ),
    )
  }
  const others: UsageOther[] = [
    ...otherEntries(config, CONSUMED_CONFIG_KEYS, 'config.'),
    ...otherEntries(raw, ['config']),
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
