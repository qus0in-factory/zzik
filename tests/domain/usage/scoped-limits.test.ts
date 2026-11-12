import { describe, it, expect } from 'vitest'
import { buildUsageView } from '../../../src/domain/usage/view'
import raw from '../../fixtures/claude-usage.scoped-limits.json'
const now = new Date('2026-11-12T12:00:00Z')
describe('Given live Claude scoped limits structure', () => {
  it('When building the report Then exposes Fable with weekly progress without duplicate windows or array issues', () => {
    const report = buildUsageView(raw, { now })
    expect(report.windows).toHaveLength(2)
    expect(report.metrics).toHaveLength(1)
    expect(report.metrics[0]).toMatchObject({ id: 'seven_day_fable', label: 'Fable 주간', unknown: false, usedPercent: 80, elapsedPercent: 50 })
    expect(report.others).toEqual([])
    expect(report.issues).toEqual([])
  })
  it('When both legacy and scoped entries exist Then scoped data wins once', () => {
    expect(buildUsageView({ ...raw, seven_day_fable: { utilization: 10 } }, { now }).metrics.map(m => m.usedPercent)).toEqual([80])
  })
  it('When a surface supplies the name Then slugs it and ignores malformed scopes', () => {
    const report = buildUsageView({ limits: [
      { kind: 'weekly_scoped', percent: 20, scope: { model: null, surface: 'Claude Code' } },
      { kind: 'weekly_scoped', percent: 20, scope: null },
      null,
    ] }, { now })
    expect(report.metrics.map(m => m.id)).toEqual(['seven_day_claude_code'])
    expect(report.issues).toEqual([])
  })
})
