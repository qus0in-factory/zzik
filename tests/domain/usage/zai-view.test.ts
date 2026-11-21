import { describe, expect, it } from 'vitest'
import { buildZaiUsageView } from '@domain/usage/zai-view'
import { cardPresentation } from '@app/usage/card-presentation'
import normal from '../../fixtures/zai-usage.normal.json'
import limited from '../../fixtures/zai-usage.limited.json'
import unknown from '../../fixtures/zai-usage.unknown-keys.json'

// fixture의 nextResetTime(ms epoch): 5시간 창 2026-11-21T11:43:25.338Z, 주간 창 2026-11-23T23:43:25.338Z
const now = new Date('2026-11-21T09:00:00Z')
const FIVE_HOUR_RESET = '2026-11-21T11:43:25.338Z'
const WEEKLY_RESET = '2026-11-23T23:43:25.338Z'

const credit = (unit: number, number: number, extra: Record<string, unknown> = {}) => ({ type: 'CREDIT_LIMIT', unit, number, percentage: 10, nextResetTime: 1795261405338, ...extra })
const wrap = (limits: unknown) => ({ code: 200, data: { limits }, success: true })

describe('Given the Z.AI Coding Plan quota view (합성 값)', () => {
  it('When normal Then a 5-hour card and a weekly card with percentage, reset time and cycle', () => {
    const report = buildZaiUsageView(normal, { now })
    expect(report.windows.map((item) => item.id)).toEqual(['five_hour', 'weekly'])
    expect(report.windows[0]).toMatchObject({ label: '5시간 한도', usedPercent: 20, resetsAt: FIVE_HOUR_RESET, cycleSeconds: 18000, status: 'normal', expired: false })
    expect(report.windows[1]).toMatchObject({ label: '주간 한도', usedPercent: 15, resetsAt: WEEKLY_RESET, cycleSeconds: 604800, status: 'normal', expired: false })
    expect(report.windows[0].elapsedPercent).toBeCloseTo(45.526, 2)
    expect(report.windows[1].elapsedPercent).toBeCloseTo(62.664, 2)
    expect(report.windows.some((item) => item.unknown)).toBe(false)
    expect(report.metrics).toEqual([])
    expect(report.issues).toEqual([])
    expect(report.status).toBe('normal')
    expect(report.raw).toBe(normal)
  })
  it('When normal Then the weekly window is not 위험 at the demo clock', () => {
    const report = buildZaiUsageView(normal, { now })
    const weekly = report.windows[1]
    const presentation = cardPresentation(weekly, null)
    expect(presentation.barLevel).not.toBe('danger')
    expect(presentation.barLevelText).not.toBe('위험')
  })
  it('When normal Then the plan level is kept in others and the response status keys are not', () => {
    const report = buildZaiUsageView(normal, { now })
    expect(report.others).toEqual([{ id: 'data.level', label: 'level', value: { kind: 'value', text: 'pro' } }])
  })
  it('When the 5-hour window is used up Then 100% and limit while the weekly card keeps its own value', () => {
    const report = buildZaiUsageView(limited, { now })
    expect(report.windows.map((item) => [item.id, item.usedPercent, item.status])).toEqual([['five_hour', 100, 'limit'], ['weekly', 68, 'normal']])
    expect(report.status).toBe('limit')
  })
  it('When an unknown limit type and unknown keys arrive Then they make no card and no issue, and unknown data keys are preserved', () => {
    const report = buildZaiUsageView(unknown, { now })
    expect(report.windows.map((item) => [item.id, item.usedPercent])).toEqual([['five_hour', 5], ['weekly', 1]])
    expect(report.issues).toEqual([])
    expect(report.others.map((other) => other.id)).toEqual(['data.level', 'data.extra'])
  })
  it('When the weekly limit comes first Then the 5-hour card still leads', () => {
    const report = buildZaiUsageView(wrap([credit(6, 1, { percentage: 30 }), credit(3, 5, { percentage: 40 })]), { now })
    expect(report.windows.map((item) => [item.id, item.usedPercent])).toEqual([['five_hour', 40], ['weekly', 30]])
  })
  it.each([
    ['an unknown unit', credit(5, 1)],
    ['an unknown number', credit(3, 1)],
    ['a string unit', credit('3' as never, 5)],
    ['another type', { ...credit(3, 5), type: 'TIME_LIMIT' }],
    ['a missing type', { unit: 3, number: 5, percentage: 10 }],
    ['a non-object entry', 'x'],
  ])('When a limit has %s Then it is ignored without an issue', (_name, entry) => {
    const report = buildZaiUsageView(wrap([entry, credit(6, 1)]), { now })
    expect(report.windows.map((item) => item.id)).toEqual(['weekly'])
    expect(report.issues).toEqual([])
  })
  it.each([['a string', 'x'], ['null', null], ['NaN', Number.NaN], ['missing', undefined]])('When a known window has %s percentage Then invalid_utilization with its path and the other card survives', (_name, percentage) => {
    const report = buildZaiUsageView(wrap([credit(6, 1), credit(3, 5, { percentage })]), { now })
    expect(report.windows.map((item) => item.id)).toEqual(['weekly'])
    expect(report.issues).toEqual([{ code: 'invalid_utilization', key: 'data.limits[1]' }])
  })
  it('When the percentage is outside 0..100 Then it is clamped', () => {
    const report = buildZaiUsageView(wrap([credit(3, 5, { percentage: 150 }), credit(6, 1, { percentage: -5 })]), { now })
    expect(report.windows.map((item) => item.usedPercent)).toEqual([100, 0])
  })
  it('When the percentage has decimals Then precision is kept', () => {
    expect(buildZaiUsageView(wrap([credit(3, 5, { percentage: 12.345 })]), { now }).windows[0].usedPercent).toBe(12.345)
  })
  it.each([['missing', undefined], ['a string', '1795261405338'], ['zero', 0], ['negative', -1], ['beyond the Date range', 9e15 * 10], ['Infinity', Number.POSITIVE_INFINITY]])('When nextResetTime is %s Then the card stays with null reset and elapsed', (_name, nextResetTime) => {
    const report = buildZaiUsageView(wrap([credit(3, 5, { nextResetTime })]), { now })
    expect(report.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 10, resetsAt: null, elapsedPercent: null, expired: false })
  })
  it('When the reset time has passed Then the card is marked expired', () => {
    const report = buildZaiUsageView(normal, { now: new Date('2026-11-21T12:00:00Z') })
    expect(report.windows.map((item) => item.expired)).toEqual([true, false])
  })
  it('When the same window appears twice Then the first valid one wins', () => {
    const report = buildZaiUsageView(wrap([credit(3, 5, { percentage: 11 }), credit(3, 5, { percentage: 99 })]), { now })
    expect(report.windows.map((item) => [item.id, item.usedPercent])).toEqual([['five_hour', 11]])
    expect(report.issues).toEqual([])
  })
  it('When limits is empty Then no cards, no issues and unknown status', () => {
    const report = buildZaiUsageView(wrap([]), { now })
    expect(report).toMatchObject({ windows: [], issues: [], status: 'unknown' })
  })
  it.each([
    ['data is missing', { code: 200, success: true }],
    ['data is not an object', { data: [] }],
    ['limits is missing', { data: { level: 'pro' } }],
    ['limits is not an array', { data: { limits: { type: 'CREDIT_LIMIT' } } }],
  ])('When %s Then invalid_shape and the raw body is kept', (_name, raw) => {
    const report = buildZaiUsageView(raw, { now })
    expect(report.issues).toEqual([{ code: 'invalid_shape' }])
    expect(report.windows).toEqual([])
    expect(report.raw).toBe(raw)
  })
  it.each([null, 'x', []])('When the shape is %j Then invalid_shape', (raw) => {
    expect(buildZaiUsageView(raw, { now })).toMatchObject({ issues: [{ code: 'invalid_shape' }], raw: null })
  })
})
