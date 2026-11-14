import { visibleUsageReport } from './visible'
import { elapsedPercent } from './elapsed'
import { aggregateUsageLevel, usageLevelOf } from './level'
import { codexWindowLabel } from './codex-labels'
import { scanCodexUsage } from './codex-windows'
import type { CodexWindowEntry } from './codex-windows'
import { formatResetRemaining, isResetExpired } from './staleness'
import type { UsageLevel, UsageMetric, UsageReport, UsageWindow } from './types'

/**
 * Codex(WHAM) 응답 → 화면 뷰 (ADR 0.3 D6).
 * 구조를 하드코딩하지 않고 `codex-windows`가 찾아낸 창을 배치한다.
 * - `rate_limit` 아래의 창 → 사용 창(길이 오름차순)
 * - 그 밖의 창 → 추가 한도(발견 순서)
 * - 창을 내지 않은 키와, 창을 낸 키의 나머지 필드 → 기타 항목
 */
export interface CodexViewOptions {
  now: Date
  /** 수집 시각(봉투의 fetchedAt). `reset_after_seconds` 계산 기준(D6). */
  fetchedAt?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

import { byWindowLength } from '../../../shared/usage-scan/codex.ts'

export function buildCodexUsageView(raw: unknown, options: CodexViewOptions): UsageReport {
  const { now } = options
  const scan = scanCodexUsage(raw, { fetchedAt: options.fetchedAt ?? null })

  const toWindow = (entry: CodexWindowEntry): UsageWindow => {
    const label = codexWindowLabel(entry)
    return {
      id: entry.path,
      label: label.label,
      unknown: label.unknown,
      usedPercent: entry.usedPercent,
      elapsedPercent: elapsedPercent(entry.resetsAt, entry.limitWindowSeconds, now),
      cycleSeconds: entry.limitWindowSeconds,
      resetsAt: entry.resetsAt,
      expired: isResetExpired(entry.resetsAt, now),
      status: usageLevelOf(entry.usedPercent),
      resetText: formatResetRemaining(entry.resetsAt, now),
    }
  }

  const toMetric = (entry: CodexWindowEntry): UsageMetric => {
    const label = codexWindowLabel(entry)
    return {
      id: entry.path,
      label: label.label,
      unknown: true,
      usedPercent: entry.usedPercent,
      elapsedPercent: elapsedPercent(entry.resetsAt, entry.limitWindowSeconds, now),
      resetsAt: entry.resetsAt,
      expired: isResetExpired(entry.resetsAt, now),
      status: usageLevelOf(entry.usedPercent),
      resetText: formatResetRemaining(entry.resetsAt, now),
    }
  }

  const windows = scan.windows
    .filter((entry) => entry.insideRateLimit)
    .slice()
    .sort(byWindowLength)
    .map(toWindow)
  const metrics = scan.windows.filter((entry) => !entry.insideRateLimit).map(toMetric)

  const status: UsageLevel = limitReached(raw)
    ? 'limit'
    : aggregateUsageLevel([...windows, ...metrics].map((item) => ({ status: item.status, expired: item.expired })))

  return visibleUsageReport({
    status,
    windows,
    metrics,
    others: scan.otherEntries.map((entry) => ({ id: entry.id, label: entry.id, value: entry.value })),
    issues: scan.issues,
    raw: isRecord(raw) ? raw : null,
  })
}

function limitReached(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  const rateLimit = raw['rate_limit']
  return isRecord(rateLimit) && rateLimit['limit_reached'] === true
}
