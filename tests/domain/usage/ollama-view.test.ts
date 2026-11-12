import { describe, expect, it } from 'vitest'
import { buildOllamaUsageView } from '@domain/usage/ollama-view'
import normal from '../../fixtures/ollama-usage.normal.json'
import limited from '../../fixtures/ollama-usage.limited.json'
import unknown from '../../fixtures/ollama-usage.unknown-keys.json'

const now = new Date('2026-11-11T12:00:00Z')

describe('Given the Ollama balance view (설계 7절, 합성 값)', () => {
  it('When normal Then one included-credit card with precision kept and cycle = until − from', () => {
    const report = buildOllamaUsageView(normal, { now })
    expect(report.windows).toHaveLength(1)
    expect(report.windows[0]).toMatchObject({ id: 'included', label: '포함 크레딧', resetsAt: '2026-12-01T00:00:00Z' })
    expect(report.windows[0].usedPercent).toBeCloseTo(((60 - 38.36) / 60) * 100, 10)
    expect(report.windows[0].elapsedPercent).toBeCloseTo(35)
    expect(report.metrics).toEqual([])
    expect(report.status).toBe('normal')
  })
  it('When normal Then purchased balance goes to others, not to a card', () => {
    const report = buildOllamaUsageView(normal, { now })
    expect(report.others).toEqual([{ id: 'purchased', label: 'purchased', value: { kind: 'object', fields: [{ key: 'balance_usd', text: '1.17' }] } }])
  })
  it('When the included balance is 0 Then 100% and limit', () => {
    const report = buildOllamaUsageView(limited, { now })
    expect(report.windows[0].usedPercent).toBe(100)
    expect(report.status).toBe('limit')
  })
  it('When the balance exceeds the allowance Then usage is clamped to 0', () => {
    const report = buildOllamaUsageView({ included: { allowance_usd: 10, balance_usd: 12 } }, { now })
    expect(report.windows[0].usedPercent).toBe(0)
  })
  it('When allowance is 0 Then invalid_utilization, no card, unknown keys preserved', () => {
    const report = buildOllamaUsageView(unknown, { now })
    expect(report.windows).toEqual([])
    expect(report.issues).toEqual([{ code: 'invalid_utilization', key: 'included' }])
    expect(report.others.map((other) => other.id)).toEqual(['purchased', 'unknown_field'])
  })
  it('When the numbers are not finite Then invalid_utilization', () => {
    expect(buildOllamaUsageView({ included: { allowance_usd: 'x', balance_usd: 1 } }, { now }).issues).toEqual([{ code: 'invalid_utilization', key: 'included' }])
    expect(buildOllamaUsageView({ included: { allowance_usd: 10 } }, { now }).issues).toEqual([{ code: 'invalid_utilization', key: 'included' }])
  })
  it('When included is missing Then invalid_entry and no card', () => {
    const report = buildOllamaUsageView({ purchased: { balance_usd: 1 } }, { now })
    expect(report.issues).toEqual([{ code: 'invalid_entry', key: 'included' }])
    expect(report.windows).toEqual([])
  })
  it('When the period is missing Then reset and elapsed are null', () => {
    const report = buildOllamaUsageView({ included: { allowance_usd: 10, balance_usd: 5 } }, { now })
    expect(report.windows[0]).toMatchObject({ resetsAt: null, elapsedPercent: null, usedPercent: 50 })
  })
  it.each([null, 'x', []])('When the shape is %j Then invalid_shape', (raw) => {
    expect(buildOllamaUsageView(raw, { now }).issues).toEqual([{ code: 'invalid_shape' }])
  })
})
