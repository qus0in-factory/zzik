import { describe, it, expect } from 'vitest'
import { buildUsageView } from '../../../src/domain/usage/view'
import { classifyUsageKeys } from '../../../src/domain/usage/classify'
import raw from '../../fixtures/claude-usage.live-scoped.json'

describe('Given Claude rawText extracted from live KV on 2026-11-12', () => {
  it('When viewed at a fixed time Then Fable appears once with live utilization and calculated weekly progress', () => {
    const now = new Date('2026-11-12T12:00:00Z')
    const report = buildUsageView(raw, { now })
    const fable = report.metrics.filter(metric => metric.id === 'seven_day_fable')
    expect(fable).toHaveLength(1)
    expect(fable[0]).toMatchObject({
      label: 'Fable 주간', unknown: false, usedPercent: 80,
      resetsAt: '2026-11-13T00:00:00.107923+00:00',
    })
    // 7 days minus the 12 hours (and 107 ms) remaining until the live reset.
    expect(fable[0].elapsedPercent).toBeCloseTo(92.85712516534392, 8)
    expect(report.windows.map(window => window.id)).toEqual(['five_hour', 'seven_day'])
    expect(report.metrics).toHaveLength(1)
    expect(report.others.map(item => item.id)).toEqual(['spend', 'member_dashboard_available', 'seven_day_breakdown'])
    expect(report.issues).toEqual([])
  })
})
describe('Given boolean top-level metadata', () => {
  it('When classifying true and false Then retains them as other values without invalid-entry issues', () => {
    const result = classifyUsageKeys({ member_dashboard_available: false, another_flag: true })
    expect(result.entries).toMatchObject([
      { kind: 'other', key: 'member_dashboard_available', otherValue: { kind: 'value', text: 'false' } },
      { kind: 'other', key: 'another_flag', otherValue: { kind: 'value', text: 'true' } },
    ])
    expect(result.issues).toEqual([])
  })
})
