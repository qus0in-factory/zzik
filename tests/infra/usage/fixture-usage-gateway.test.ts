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

describe('Given the claude fixture gateway', () => {
  it('When the query selects normal then it returns the normal usage', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('claude')
    expect(result).toMatchObject({ ok: true, usage: { five_hour: { utilization: 37, resets_at: '2026-11-11T14:13:00.000Z' } } })
  })

  it('When the query selects unknown-keys then the raw usage keeps unknown keys', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('claude')
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.usage ?? {})).toContain('seven_day_fable')
  })

  it('When the query selects error then it fails with api_error', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=error', now: ANCHOR_CLOCK })
    expect(await gateway.fetchUsage('claude')).toEqual({ ok: false, reason: 'api_error', message: expect.any(String) })
  })

  it('When the query selects loading then the request stays pending', () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=loading', now: ANCHOR_CLOCK })
    expect(gateway.fetchUsage('claude')).toBeInstanceOf(Promise)
  })
})

describe('Given the fixture gateway recalculating resets_at against the current time', () => {
  it('When now is the fixture anchor then resets_at stays as authored', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('claude')
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage?.five_hour).toEqual({ utilization: 37, resets_at: '2026-11-11T14:13:00.000Z' })
    expect(result.usage?.seven_day).toEqual({ utilization: 12, resets_at: '2026-11-14T09:00:00.000Z' })
  })

  it('When now is ten days after the anchor then every resets_at moves by ten days', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: LATER_CLOCK })
    const result = await gateway.fetchUsage('claude')
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage?.five_hour).toEqual({ utilization: 37, resets_at: '2026-11-21T14:13:00.000Z' })
    expect(result.usage?.seven_day).toEqual({ utilization: 12, resets_at: '2026-11-24T09:00:00.000Z' })
  })

  it('When entries are null or have no resets_at then they are left alone', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys', now: LATER_CLOCK })
    const result = await gateway.fetchUsage('claude')
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage?.seven_day_opus).toBeNull()
    expect(result.usage?.seven_day_haiku).toEqual({ utilization: 3, resets_at: null })
    expect(result.usage?.extra_usage).toEqual({ utilization: 5 })
  })
})

describe('Given the codex fixture gateway (ADR 0.3 D6/D8)', () => {
  it('When the provider is codex then the WHAM shaped fixture is returned', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect(result.usage?.rate_limit).toMatchObject({ limit_reached: false })
    expect((result.usage?.rate_limit as Record<string, unknown>).primary_window).toMatchObject({ used_percent: 20, limit_window_seconds: 18000 })
  })

  it('When the codex limitation is requested then limit_reached is true', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=limited', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect((result.usage?.rate_limit as Record<string, unknown>).limit_reached).toBe(true)
  })

  it('When the codex unknown-keys scenario is requested then the extra buckets stay in the payload', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.usage ?? {})).toEqual(
      expect.arrayContaining(['rate_limit', 'code_review_rate_limit', 'mcp', 'broken_bucket', 'daily']),
    )
  })

  it('When the scenario is warn (no codex fixture) then it falls back to the normal codex payload', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=warn', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect((result.usage?.rate_limit as Record<string, unknown>).primary_window).toMatchObject({ used_percent: 20 })
  })

  it('When the fixture choice comes from the store getter then it wins over the search string', async () => {
    const gateway = createFixtureUsageGateway({
      getSearch: () => '?fixture=normal',
      getFixtureName: () => 'limited',
      now: ANCHOR_CLOCK,
    })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect((result.usage?.rate_limit as Record<string, unknown>).limit_reached).toBe(true)
  })
})

describe('Given the auth_rejected fixture scenario (ADR 0.3 v2)', () => {
  it('When the scenario is auth_rejected then the envelope says the server rejected the token', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=auth_rejected', now: ANCHOR_CLOCK })
    const result = await gateway.fetchUsage('codex')
    if (!result.ok) throw new Error('expected ok')
    expect(result.collection).toMatchObject({ status: 'auth_rejected', httpStatus: 401, provider: 'codex' })
    expect(result.usage).not.toBeNull()
  })

  it('When the scenario name parses then auth_rejected is a known name', () => {
    expect(parseFixtureUsageName('?fixture=auth_rejected')).toBe('auth_rejected')
  })
})
