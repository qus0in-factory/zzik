import { visibleUsageReport } from '@domain/usage/visible'
import { describe, it, expect } from 'vitest'
import { buildUsageView } from '@domain/usage/view'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import claude from '../../fixtures/claude-usage.live-scoped.json'
import codex from '../../fixtures/codex-usage.live.json'
const now = new Date('2026-11-12T12:00:00Z')
describe('Given live usage fixtures', () => {
  it('When Claude is displayed Then only populated limits and other values remain', () => {
    const report = buildUsageView(claude, { now })
    expect(report.windows.map(item => [item.id, item.label])).toEqual([['five_hour', '5시간 한도'], ['seven_day', '주간 한도']])
    expect(report.metrics.map(item => [item.id, item.label])).toEqual([['seven_day_fable', 'Fable 주간']])
    expect(report.others.map(item => item.id)).toEqual(['extra_usage', 'spend', 'member_dashboard_available', 'seven_day_breakdown'])
    expect(report.raw).toEqual(claude)
  })
  it('When Codex is displayed Then empty secondary limits and metadata are omitted', () => {
    const report = buildCodexUsageView(codex, { now })
    expect(report.windows.map(item => [item.id, item.label])).toEqual([['rate_limit.primary_window', '주간 한도']])
    expect(report.metrics).toEqual([])
    expect(report.others.map(item => item.id)).toEqual(['plan_type', 'model_usage', 'credits', 'spend_control', 'rate_limit_reset_credits'])
  })
})
describe('Given absent and valid zero or false values', () => {
  it('When building a report Then hides null percentages and recursively empty other values but retains zero and false', () => {
    const raw = { five_hour: null, seven_day: { utilization: 0 }, empty: {}, nested: { a: null, b: [], c: { d: '' } }, blank: ' ', empty_array: [], bool: false, object: { empty: null, present: 0 } }
    const report = buildUsageView(raw, { now })
    expect(report.windows.map(item => item.id)).toEqual(['seven_day'])
    expect(report.metrics).toEqual([])
    expect(report.others.map(item => item.id)).toEqual(['bool', 'object'])
    expect(report.others[1].value).toEqual({ kind: 'object', fields: [{ key: 'present', text: '0' }] })
  })
})

describe('Given nested redaction paths and placeholder fallback', () => {
  it('When a JSON-valued field contains redactions Then excludes only those paths while preserving valid siblings and raw', () => {
    const raw = { details: { nested: { email: 'different-mask', count: 0 }, label: '[가림]' }, public_name: 'available' }
    const report = visibleUsageReport(buildUsageView(raw, { now }), ['details.nested.email'])
    expect(report.others).toMatchObject([
      { id: 'details', value: { fields: [{ key: 'nested', text: '{"count":0}' }] } },
      { id: 'public_name', value: { text: 'available' } },
    ])
    expect(report.raw).toEqual(raw)
  })
  it('When a whole container is redacted Then excludes its descendants without hiding similarly named fields', () => {
    const report = visibleUsageReport(buildUsageView({ private: { count: 1 }, private_extra: { count: 2 } }, { now }), ['private'])
    expect(report.others.map(item => item.id)).toEqual(['private_extra'])
  })
})
