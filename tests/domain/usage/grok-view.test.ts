import { describe, expect, it } from 'vitest'
import { buildGrokUsageView } from '@domain/usage/grok-view'
import normal from '../../fixtures/grok-usage.normal.json'
import limited from '../../fixtures/grok-usage.limited.json'
import unknown from '../../fixtures/grok-usage.unknown-keys.json'

const now = new Date('2026-11-11T12:00:00Z')

describe('Given the Grok credits view (설계 7절, 합성 값)', () => {
  it('When normal Then one weekly credits card with cycle = end − start', () => {
    const report = buildGrokUsageView(normal, { now })
    expect(report.windows).toHaveLength(1)
    expect(report.windows[0]).toMatchObject({ id: 'credits', label: '주간 크레딧', usedPercent: 2, resetsAt: '2026-11-16T00:00:00.000Z', status: 'normal' })
    expect(report.windows[0].unknown).toBeUndefined()
    expect(report.windows[0].elapsedPercent).toBeCloseTo(100 * (1 - 4.5 / 7))
    expect(report.metrics).toEqual([])
    expect(report.issues).toEqual([])
    expect(report.raw).toEqual(normal)
  })
  it('When normal Then others keep the rest of config and top-level keys, not the consumed ones', () => {
    const ids = buildGrokUsageView(normal, { now }).others.map((other) => other.id)
    expect(ids).toEqual(['config.currentPeriod', 'config.productUsage', 'config.isUnifiedBillingUser', 'config.prepaidBalance', 'config.topUpMethod'])
  })
  it('When the period type is monthly Then the label follows the table and the cycle still comes from the dates', () => {
    const monthly = { config: { ...normal.config, currentPeriod: { ...normal.config.currentPeriod, type: 'USAGE_PERIOD_TYPE_MONTHLY' }, billingPeriodStart: '2026-11-01T00:00:00.000Z', billingPeriodEnd: '2026-12-01T00:00:00.000Z' } }
    const window = buildGrokUsageView(monthly, { now }).windows[0]
    expect(window.label).toBe('월간 크레딧')
    expect(window.elapsedPercent).toBeCloseTo(100 * (1 - 19.5 / 30))
  })
  it('When the percent is 100 Then the report is at its limit', () => {
    expect(buildGrokUsageView(limited, { now }).status).toBe('limit')
  })
  it('When the type is unknown and the percent is a string Then the card is dropped with an issue', () => {
    const report = buildGrokUsageView(unknown, { now })
    expect(report.windows).toEqual([])
    expect(report.issues).toEqual([{ code: 'invalid_utilization', key: 'config.creditUsagePercent' }])
    expect(report.others.map((other) => other.id)).toContain('config.futureField')
    expect(report.others.map((other) => other.id)).toContain('unknown_field')
  })
  it('When the type is unknown with a valid percent Then the generic label and the unknown badge', () => {
    const report = buildGrokUsageView({ config: { ...unknown.config, creditUsagePercent: 12.5 } }, { now })
    expect(report.windows[0]).toMatchObject({ label: '크레딧 사용률', unknown: true, usedPercent: 12.5 })
  })
  it('When the percent is out of range Then it is clamped; non-finite is an issue', () => {
    expect(buildGrokUsageView({ config: { creditUsagePercent: 140 } }, { now }).windows[0].usedPercent).toBe(100)
    expect(buildGrokUsageView({ config: { creditUsagePercent: null } }, { now }).issues).toEqual([{ code: 'invalid_utilization', key: 'config.creditUsagePercent' }])
  })
  it.each([null, 'x', [], {}, { config: 'x' }, { creditUsagePercent: 3 }])('When the shape is %j Then invalid_shape and no cards', (raw) => {
    const report = buildGrokUsageView(raw, { now })
    expect(report.issues).toEqual([{ code: 'invalid_shape' }])
    expect(report.windows).toEqual([])
    expect(report.status).toBe('unknown')
  })
  it('When the cycle dates are missing Then elapsed is null', () => {
    const report = buildGrokUsageView({ config: { creditUsagePercent: 5, billingPeriodEnd: '2026-11-16T00:00:00.000Z' } }, { now })
    expect(report.windows[0].elapsedPercent).toBeNull()
  })
})
