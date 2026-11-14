/** "충분히 쌓임" 판정(ADR 0.7 10절). ok 이벤트 2건 이상 그리고 첫 ok부터 마지막 ok까지 6시간 이상. 실패 이벤트는 세지 않는다. */
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../../shared/usage-history-contract'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'

export const HISTORY_MIN_SPAN_MS = 6 * 3_600_000

export type HistoryEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'no_data' | 'too_few' | 'too_short'; okCount: number; remainingMs: number | null }

export function historyEligibility(entry: UsageHistorySummaryEntry | null): HistoryEligibility {
  if (entry === null || entry.okCount <= 0) return { eligible: false, reason: 'no_data', okCount: 0, remainingMs: null }
  if (entry.okCount < USAGE_HISTORY_MIN_OK_EVENTS) return { eligible: false, reason: 'too_few', okCount: entry.okCount, remainingMs: null }
  const first = entry.firstOkAt === null ? NaN : Date.parse(entry.firstOkAt)
  const last = entry.lastOkAt === null ? NaN : Date.parse(entry.lastOkAt)
  const span = last - first
  if (!Number.isFinite(span) || span < HISTORY_MIN_SPAN_MS) {
    return { eligible: false, reason: 'too_short', okCount: entry.okCount, remainingMs: Number.isFinite(span) ? HISTORY_MIN_SPAN_MS - span : HISTORY_MIN_SPAN_MS }
  }
  return { eligible: true }
}
