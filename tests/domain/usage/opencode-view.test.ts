import { describe, expect, it } from 'vitest'
import { buildOpencodeUsageView } from '@domain/usage/opencode-view'
import normal from '../../fixtures/opencode-usage.normal.json'
import limited from '../../fixtures/opencode-usage.limited.json'
import unknown from '../../fixtures/opencode-usage.unknown-keys.json'

const now = new Date('2026-11-11T12:00:00Z')

describe('Given the OpenCode usage view (설계 7절, 합성 값)', () => {
  it('When normal Then cards follow rolling → weekly → monthly', () => {
    const report = buildOpencodeUsageView(normal, { now })
    expect(report.windows.map((window) => [window.id, window.label, window.usedPercent])).toEqual([
      ['rolling', '단기 한도', 0],
      ['weekly', '주간 한도', 16],
      ['monthly', '월간 한도', 10],
    ])
    expect(report.status).toBe('normal')
    expect(report.metrics).toEqual([])
    expect(report.others).toEqual([])
  })
  it('When normal Then only weekly has an elapsed bar', () => {
    const [rolling, weekly, monthly] = buildOpencodeUsageView(normal, { now }).windows
    expect(rolling.elapsedPercent).toBeNull()
    expect(monthly.elapsedPercent).toBeNull()
    expect(weekly.elapsedPercent).toBeCloseTo(100 * (1 - 2.5 / 7))
  })
  it('When the table order differs from the response order Then the table order wins', () => {
    const report = buildOpencodeUsageView({ usage: { monthly: { percent: 1 }, rolling: { percent: 2 } } }, { now })
    expect(report.windows.map((window) => window.id)).toEqual(['rolling', 'monthly'])
  })
  it('When a fourth window and a missing percent exist Then it is sorted after, flagged unknown, and the bad one is an issue', () => {
    const report = buildOpencodeUsageView(unknown, { now })
    expect(report.windows.map((window) => window.id)).toEqual(['rolling', 'monthly', 'daily'])
    expect(report.windows[2]).toMatchObject({ label: 'daily 한도', unknown: true, elapsedPercent: null })
    expect(report.issues).toEqual([{ code: 'invalid_utilization', key: 'usage.weekly' }])
    expect(report.others.map((other) => other.id)).toEqual(['unknown_field'])
  })
  it('When a window is not an object Then invalid_entry', () => {
    expect(buildOpencodeUsageView({ usage: { weekly: 3 } }, { now }).issues).toEqual([{ code: 'invalid_entry', key: 'usage.weekly' }])
  })
  it('When a window is at 100 Then the report is at its limit until it resets', () => {
    expect(buildOpencodeUsageView(limited, { now }).status).toBe('limit')
    expect(buildOpencodeUsageView(limited, { now: new Date('2026-11-12T00:00:00Z') }).status).toBe('normal')
  })
  it('When the status field exists Then it is ignored', () => {
    const report = buildOpencodeUsageView({ usage: { weekly: { status: 'ok', percent: 80 } } }, { now })
    expect(report.windows[0].status).toBe('warn')
    expect(report.others).toEqual([])
  })
  it.each([null, [], 'x', {}, { usage: 3 }, { usage: [] }])('When the shape is %j Then invalid_shape', (raw) => {
    expect(buildOpencodeUsageView(raw, { now }).issues).toEqual([{ code: 'invalid_shape' }])
  })
})
