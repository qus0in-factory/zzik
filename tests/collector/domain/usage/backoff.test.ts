import { describe, expect, it } from 'vitest'
import { authRetryDelaySec, retryDelaySec } from '../../../../collector/domain/usage/backoff.mjs'

describe('Given the 429 backoff without Retry-After', () => {
  it.each([
    [0, 600],
    [1, 1200],
    [2, 2400],
    [3, 3600],
    [4, 3600],
    [9, 3600],
  ] as const)('When the consecutive failure count is %s then the wait is %s seconds', (failCount, expected) => {
    expect(retryDelaySec('rate_limited', failCount, null)).toBe(expected)
  })
})

describe('Given the 429 backoff with Retry-After', () => {
  it('When the server waits longer than the exponential cap then its instruction wins', () => {
    // 상한 3600은 지수항에만 걸린다(D5). Retry-After 7200은 잘리지 않는다(V3).
    expect(retryDelaySec('rate_limited', 0, 7200)).toBe(7200)
  })

  it('When Retry-After is shorter then the exponential term decides', () => {
    expect(retryDelaySec('rate_limited', 2, 300)).toBe(2400)
    expect(retryDelaySec('rate_limited', 0, 300)).toBe(600)
  })
})

describe('Given the upstream error backoff', () => {
  it.each([
    [0, 600],
    [1, 900],
    [2, 900],
  ] as const)('When the failure count is %s then the wait is %s seconds (cap 900)', (failCount, expected) => {
    expect(retryDelaySec('upstream_error', failCount, null)).toBe(expected)
  })

  it('When Retry-After is present on a 5xx then it is ignored', () => {
    expect(retryDelaySec('upstream_error', 0, 7200)).toBe(600)
  })
})

describe('Given the auth denial sequence (v2 D4)', () => {
  it.each([
    [0, 3_600],
    [1, 7_200],
    [2, 14_400],
    [3, 21_600],
    [5, 21_600],
  ] as const)('When the auth failure count is %s then the wait is %s seconds (상한 21,600)', (failCount, expected) => {
    expect(authRetryDelaySec(failCount)).toBe(expected)
  })
})
