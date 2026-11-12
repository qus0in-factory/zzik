import { describe, it, expect } from 'vitest'
import { buildUsageView } from '../../../src/domain/usage/view'
import { buildCodexUsageView } from '../../../src/domain/usage/codex-view'

describe('Given reset cycles', () => {
  const now = new Date('2026-11-12T12:00:00Z')
  it('When halfway through five hours Then returns 50 percent', () => {
    expect(buildUsageView({ five_hour: { utilization: 20, resets_at: '2026-11-12T14:30:00Z' } }, { now }).windows[0].elapsedPercent).toBe(50)
  })
  it('When Fable is present Then it is known and has a weekly cycle', () => {
    expect(buildUsageView({ seven_day_fable: { utilization: 10, resets_at: '2026-11-16T00:00:00Z' } }, { now }).metrics[0]).toMatchObject({ label: 'Fable 주간', unknown: false, elapsedPercent: 50 })
  })
  it('When reset is absent or invalid Then elapsed is null', () => {
    for (const resets_at of [null, 'invalid']) expect(buildUsageView({ five_hour: { utilization: 20, resets_at } }, { now }).windows[0].elapsedPercent).toBeNull()
  })
  it('When outside the cycle Then clamps the value', () => {
    for (const [resets_at, expected] of [['2026-11-12T11:00:00Z', 100], ['2026-11-13T12:00:00Z', 0]] as const)
      expect(buildUsageView({ five_hour: { utilization: 20, resets_at } }, { now }).windows[0].elapsedPercent).toBe(expected)
  })
  it('When Codex supplies a duration Then uses it', () => {
    expect(buildCodexUsageView({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 7200, reset_at: now.getTime() / 1000 + 3600 } } }, { now }).windows[0].elapsedPercent).toBe(50)
  })
})
