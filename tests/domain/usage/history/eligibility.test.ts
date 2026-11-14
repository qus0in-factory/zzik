import { describe, expect, it } from 'vitest'
import { HISTORY_MIN_SPAN_MS, historyEligibility } from '@domain/usage/history/eligibility'
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../../shared/usage-history-contract'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'

const entry = (okCount: number, spanMs: number): UsageHistorySummaryEntry => ({ provider: 'claude', okCount, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: new Date(Date.parse('2026-11-10T00:00:00.000Z') + spanMs).toISOString() })
const HOUR = 3_600_000

describe('Given the history eligibility (ok 2건 이상 그리고 6시간 이상)', () => {
  it('Then the contract minimum is relaxed to two ok events and the span is six hours', () => {
    expect(USAGE_HISTORY_MIN_OK_EVENTS).toBe(2)
    expect(HISTORY_MIN_SPAN_MS).toBe(6 * HOUR)
  })
  it('When ok count is 2 and the span is exactly 6 hours Then eligible (변화 적은 제공자)', () => {
    expect(historyEligibility(entry(2, 6 * HOUR))).toEqual({ eligible: true })
  })
  it('When ok count is 1 Then too_few with the count and no remaining time', () => {
    expect(historyEligibility(entry(1, 48 * HOUR))).toEqual({ eligible: false, reason: 'too_few', okCount: 1, remainingMs: null })
  })
  it('When the span is 5h59m Then too_short with the remaining time', () => {
    expect(historyEligibility(entry(2, 6 * HOUR - 60_000))).toEqual({ eligible: false, reason: 'too_short', okCount: 2, remainingMs: 60_000 })
  })
  it('When there is no entry or no ok events Then no_data', () => {
    expect(historyEligibility(null)).toEqual({ eligible: false, reason: 'no_data', okCount: 0, remainingMs: null })
    expect(historyEligibility({ provider: 'claude', okCount: 0, firstOkAt: null, lastOkAt: null })).toMatchObject({ eligible: false, reason: 'no_data' })
  })
  it('When the dates are missing or invalid although count is enough Then too_short without crashing', () => {
    expect(historyEligibility({ provider: 'claude', okCount: 2, firstOkAt: null, lastOkAt: null })).toMatchObject({ eligible: false, reason: 'too_short' })
  })
})
