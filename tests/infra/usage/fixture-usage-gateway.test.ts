import { describe, expect, it } from 'vitest'
import { createFixtureUsageGateway, parseFixtureUsageName } from '@infra/usage/fixture-usage-gateway'

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
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=normal' })
    const result = await gateway.fetchUsage()
    expect(result).toEqual({ ok: true, usage: expect.objectContaining({ five_hour: { utilization: 37, resets_at: '2026-11-11T14:13:00.000Z' } }) })
  })

  it('When the query selects unknown-keys then the raw usage keeps unknown keys', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=unknown-keys' })
    const result = await gateway.fetchUsage()
    if (!result.ok) throw new Error('expected ok')
    expect(Object.keys(result.usage)).toContain('seven_day_fable')
  })

  it('When the query selects error then it fails with api_error', async () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=error' })
    expect(await gateway.fetchUsage()).toEqual({ ok: false, reason: 'api_error', message: expect.any(String) })
  })

  it('When the query selects loading then the request stays pending', () => {
    const gateway = createFixtureUsageGateway({ getSearch: () => '?fixture=loading' })
    const pending = gateway.fetchUsage()
    expect(pending).toBeInstanceOf(Promise)
  })
})
