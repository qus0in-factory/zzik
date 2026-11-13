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
  it('When normal Then weekly and monthly have an elapsed bar, rolling does not', () => {
    const [rolling, weekly, monthly] = buildOpencodeUsageView(normal, { now }).windows
    expect(rolling.elapsedPercent).toBeNull()
    expect(weekly.elapsedPercent).toBeCloseTo(100 * (1 - 2.5 / 7))
    // 11-01 ~ 12-01 = 30일, 지금은 11-11 12:00 → 10.5일 경과
    expect(monthly.elapsedPercent).toBeCloseTo((100 * 10.5) / 30)
  })
  it.each([
    ['2026-12-01T00:00:00.000Z', 30], // 11월
    ['2026-03-01T00:00:00.000Z', 28], // 2월(평년)
    ['2028-03-01T00:00:00.000Z', 29], // 2월(윤년)
    ['2026-01-01T00:00:00.000Z', 31], // 12월
    ['2026-03-31T00:00:00.000Z', 31], // 2/31 없음 → 2/28로 보정 (2/28~3/31)
    ['2026-01-15T06:30:00.000Z', 31], // 시각 유지
  ])('When monthly resets at %s Then the cycle is %i days of the previous calendar month', (resetsAt, days) => {
    const report = buildOpencodeUsageView({ usage: { monthly: { percent: 5, resetsAt } } }, { now })
    // 리셋 1초 전: 경과율은 (주기-1초)/주기 → 주기 길이를 역산
    const at = new Date(new Date(resetsAt).getTime() - 1000)
    const elapsed = buildOpencodeUsageView({ usage: { monthly: { percent: 5, resetsAt } } }, { now: at }).windows[0].elapsedPercent
    expect(elapsed).toBeCloseTo(100 * (1 - 1 / (days * 86_400)), 6)
  })
  it('When monthly or rolling has no resetsAt Then no elapsed bar', () => {
    const report = buildOpencodeUsageView({ usage: { rolling: { percent: 1, resetsAt: '2026-11-11T17:00:00.000Z' }, monthly: { percent: 5 } } }, { now })
    expect(report.windows.map((window) => window.elapsedPercent)).toEqual([null, null])
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
