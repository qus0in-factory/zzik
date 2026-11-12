import { describe, expect, it } from 'vitest'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import limitedRaw from '../../fixtures/claude-usage.limited.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'
import warnRaw from '../../fixtures/claude-usage.warn.json'

const NOW = new Date('2026-11-11T12:00:00.000Z')

describe('Given the Anthropic usage fixture (normal)', () => {
  it('When parsing then it yields the two fixed windows and populated metrics in order', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    expect(report.windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day'])
    expect(report.windows[0]).toMatchObject({ usedPercent: 37, status: 'normal', expired: false })
    expect(report.windows[1]).toMatchObject({ usedPercent: 12, status: 'normal', expired: false })
    expect(report.metrics.map((m) => m.id)).toEqual(['seven_day_sonnet', 'extra_usage'])
    expect(report.metrics).toHaveLength(2)
    expect(report.status).toBe('normal')
    expect(report.issues).toEqual([])
  })

  it('When a metric value is null then it is omitted', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    const opus = report.metrics.find((m) => m.id === 'seven_day_opus')
    expect(opus).toBeUndefined()
  })

  it('When a metric value is zero then it is normal, not unknown', () => {
    const report = buildUsageView(warnRaw, { now: NOW })
    const apps = report.metrics.find((m) => m.id === 'seven_day_oauth_apps')
    expect(apps?.usedPercent).toBe(0)
    expect(apps?.status).toBe('normal')
  })

  it('When raw is preserved then report.raw is deep equal to the input', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    expect(report.raw).toEqual(unknownKeysRaw)
    expect(JSON.stringify(report.raw)).toContain('seven_day_fake')
  })
})

describe('Given the Anthropic usage fixture (warn)', () => {
  it('When a percentage reaches the warn threshold then the entries and report are warn', () => {
    const report = buildUsageView(warnRaw, { now: NOW })
    expect(report.windows[0]).toMatchObject({ usedPercent: 84, status: 'warn' })
    expect(report.metrics.find((m) => m.id === 'seven_day_sonnet')).toMatchObject({ usedPercent: 81, status: 'warn' })
    expect(report.metrics.find((m) => m.id === 'seven_day_oauth_apps')).toMatchObject({ status: 'normal' })
    expect(report.status).toBe('warn')
  })
})

describe('Given the Anthropic usage fixture (limited)', () => {
  it('When percent is 100 or overage 104 then the entries are limit', () => {
    const report = buildUsageView(limitedRaw, { now: NOW })
    expect(report.windows[0]).toMatchObject({ usedPercent: 100, status: 'limit' })
    expect(report.metrics.find((m) => m.id === 'seven_day_sonnet')).toMatchObject({ usedPercent: 104, status: 'limit' })
    expect(report.status).toBe('limit')
  })

  it('When a limit passed its reset time then it keeps its badge but is excluded from aggregate', () => {
    const report = buildUsageView(limitedRaw, { now: NOW })
    const cowork = report.metrics.find((m) => m.id === 'seven_day_cowork')
    expect(cowork).toMatchObject({ expired: true, status: 'limit' })
    expect(report.status).toBe('limit')
    expect(buildUsageView({ seven_day_cowork: { utilization: 100, resets_at: '2026-11-11T11:30:00.000Z' } }, { now: NOW }).status).toBe('normal')
  })

  it('When a limit has no reset time then it is not expired and counts in aggregate', () => {
    const report = buildUsageView(limitedRaw, { now: NOW })
    const extra = report.metrics.find((m) => m.id === 'extra_usage')
    expect(extra).toMatchObject({ expired: false, resetsAt: null, status: 'limit' })
    expect(buildUsageView({ extra_usage: { utilization: 100 } }, { now: NOW }).status).toBe('limit')
  })
})

describe('Given unknown keys in the usage fixture', () => {
  it('When metrics are collected then new keys are listed after known ids in lexicographic order', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    expect(report.metrics.map((m) => m.id)).toEqual([
      'seven_day_sonnet',
      'extra_usage',
      'seven_day_fake',
      'seven_day_haiku',
      'thirty_day',
    ])
    expect(report.windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day'])
  })

  it('When the report status is aggregated from a single entry then a sole value decides it', () => {
    expect(buildUsageView({ five_hour: { utilization: 85, resets_at: '2026-11-11T13:00:00.000Z' } }, { now: NOW })).toMatchObject({
      status: 'warn',
    })
    expect(buildUsageView({ five_hour: { utilization: 85, resets_at: '2026-11-11T13:00:00.000Z' } }, { now: NOW }).windows).toHaveLength(1)
    expect(buildUsageView({ five_hour: { utilization: 85, resets_at: '2026-11-11T13:00:00.000Z' } }, { now: NOW }).metrics).toEqual([])
    expect(buildUsageView({ seven_day_opus: null }, { now: NOW }).status).toBe('unknown')
  })
})

describe('Given malformed usage input', () => {
  it.each([
    [{ five_hour: { utilization: -5 } }] as const,
    [{ five_hour: { utilization: '37' } }] as const,
  ])('When utilization is invalid (%j) then the entry is hidden and the issue is retained', (input) => {
    const report = buildUsageView(input, { now: NOW })
    expect(report.windows).toEqual([])
    expect(report.issues).toContainEqual({ code: 'invalid_utilization', key: 'five_hour' })
  })

  it('When a key value is an array then it is excluded from windows and metrics but reported as an issue', () => {
    const report = buildUsageView({ five_hour: [] }, { now: NOW })
    expect(report.windows).toEqual([])
    expect(report.metrics).toEqual([])
    expect(report.issues).toContainEqual({ code: 'invalid_entry', key: 'five_hour' })
  })

  it.each([[null], [[]], ['oops']])('When the top level is not an object (%j) then nothing throws and only invalid_shape is reported', (input) => {
    const report = buildUsageView(input, { now: NOW })
    expect(report.windows).toEqual([])
    expect(report.metrics).toEqual([])
    expect(report.status).toBe('unknown')
    expect(report.issues).toEqual([{ code: 'invalid_shape' }])
  })

  it('When the top level is an empty object then the report is unknown without issues', () => {
    const report = buildUsageView({}, { now: NOW })
    expect(report.windows).toEqual([])
    expect(report.metrics).toEqual([])
    expect(report.status).toBe('unknown')
    expect(report.issues).toEqual([])
  })
})
