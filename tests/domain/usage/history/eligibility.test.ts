import { describe, expect, it } from 'vitest'
import { HISTORY_MIN_SPAN_MS, historyEligibility } from '@domain/usage/history/eligibility'
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../../shared/usage-history-contract'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'

const entry = (okCount: number, spanMs: number): UsageHistorySummaryEntry => ({ provider: 'claude', okCount, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: new Date(Date.parse('2026-11-10T00:00:00.000Z') + spanMs).toISOString() })

describe('Given the history eligibility (ok 1건 이상이면 바로 연다)', () => {
  it('Then the contract minimum is one ok event and there is no span requirement', () => {
    expect(USAGE_HISTORY_MIN_OK_EVENTS).toBe(1)
    expect(HISTORY_MIN_SPAN_MS).toBe(0)
  })
  it('When ok count is 1 with zero span Then eligible (변화 없는 제공자의 첫 하트비트)', () => {
    expect(historyEligibility(entry(1, 0))).toEqual({ eligible: true })
  })
  it('When ok count is 2 over minutes Then eligible', () => {
    expect(historyEligibility(entry(2, 10 * 60_000))).toEqual({ eligible: true })
  })
  it('When there is no entry or no ok events Then no_data', () => {
    expect(historyEligibility(null)).toEqual({ eligible: false, reason: 'no_data', okCount: 0, remainingMs: null })
    expect(historyEligibility({ provider: 'claude', okCount: 0, firstOkAt: null, lastOkAt: null })).toMatchObject({ eligible: false, reason: 'no_data' })
  })
  it('When the dates are missing or invalid although count is enough Then too_short without crashing', () => {
    expect(historyEligibility({ provider: 'claude', okCount: 1, firstOkAt: null, lastOkAt: null })).toMatchObject({ eligible: false, reason: 'too_short' })
  })
})
