import { describe, expect, it } from 'vitest'
import { createFixtureUsageGateway, FIXTURE_ANCHOR_ISO, parseFixtureUsageName } from '@infra/usage/fixture-usage-gateway'

const ANCHOR_CLOCK = (): string => FIXTURE_ANCHOR_ISO
const LATER_CLOCK = (): string => '2026-11-21T12:00:00.000Z'

describe('Given the fixture gateway name from the URL query', () => {
  it.each([
    ['', 'normal'],
    [undefined, 'normal'],
    ['?fixture=warn', 'warn'],
    ['?fixture=limited', 'limited'],
    ['?fixture=unknown-keys', 'unknown-keys'],
    ['?fixture=error', 'error'],
    ['?fixture=loading', 'loading'],
    ['foo=1&fixture=limited', 'limited'],
    ['?fixture=bogus', 'normal'],
  ] as const)('When the search is %j then the fixture is %s', (search, expected) => {
    expect(parseFixtureUsageName(search)).toBe(expected)
  })
})

describe('Given the fixture gateway', () => {
  it('When the query selects normal then it returns the normal usage', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage()
    expect(result).toEqual({ ok: true, usage: expect.objectContaining({ five_hour: { utilization: 37, resets_at: '2026-11-11T14:13:00.000Z' } }) })
  })

  it('When the query selects unknown-keys then the raw usage keeps unknown keys', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.usage)).toContain('seven_day_fable')
  })

  it('When the query selects error then it fails with api_error', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=error', now: ANCHOR_CLOCK })
    expect(await gateway.fetchUsage()).toEqual({ ok: false, reason: 'api_error', message: expect.any(String) })
  })

  it('When the query selects loading then the request stays pending', () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=loading', now: ANCHOR_CLOCK })
    const pending = gateway.fetchUsage()
    expect(pending).toBeInstanceOf(Promise)
  })
})

describe('Given the fixture gateway recalculating resets_at against the current time', () => {
  it('When now is the fixture anchor then resets_at stays as authored', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage.five_hour).toEqual({ utilization: 37, resets_at: '2026-11-11T14:13:00.000Z' })
    expect(result.usage.seven_day).toEqual({ utilization: 12, resets_at: '2026-11-14T09:00:00.000Z' })
  })

  it('When now is ten days after the anchor then every resets_at moves by ten days', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: LATER_CLOCK })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage.five_hour).toEqual({ utilization: 37, resets_at: '2026-11-21T14:13:00.000Z' })
    expect(result.usage.seven_day).toEqual({ utilization: 12, resets_at: '2026-11-24T09:00:00.000Z' })
    expect(result.usage.seven_day_sonnet).toEqual({ utilization: 5, resets_at: '2026-11-24T09:00:00.000Z' })
  })

  it('When a fixture window was already expired then it stays expired after the shift', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=limited', now: LATER_CLOCK })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage.seven_day_cowork).toEqual({ utilization: 100, resets_at: '2026-11-21T11:30:00.000Z' })
    expect(Date.parse('2026-11-21T11:30:00.000Z')).toBeLessThan(Date.parse(LATER_CLOCK()))
  })

  it('When entries are null or have no resets_at then they are left alone', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys', now: LATER_CLOCK })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage.seven_day_opus).toBeNull()
    expect(result.usage.seven_day_cowork).toBeNull()
    expect(result.usage.seven_day_haiku).toEqual({ utilization: 3, resets_at: null })
    expect(result.usage.extra_usage).toEqual({ utilization: 5 })
  })

  it('When the same fixture is served twice then the shift is stable (no drift)', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=warn', now: LATER_CLOCK })
    const first = await gateway.fetchUsage()
    const second = await gateway.fetchUsage()
    expect(second).toEqual(first)
  })
})
