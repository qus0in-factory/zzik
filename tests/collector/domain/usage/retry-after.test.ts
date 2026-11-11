import { describe, expect, it } from 'vitest'
import { parseRetryAfter } from '../../../../collector/domain/usage/retry-after.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')

describe('Given a Retry-After header value', () => {
  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['abc', null],
    ['1.5', null],
    ['0', null],
    ['-5', null],
    ['120', 300], // 하한 300초로 자른다
    ['300', 300],
    ['7200', 7200], // 상한(RA는 지수 상한과 별개)이 없어 7200을 유지한다
    ['86400', 86400],
    ['200000', 86400],
    [42, null], // 숫자가 아닌 타입은 없는 것으로 본다
  ] as const)('When the value is %j then the wait seconds are %j', (value, expected) => {
    expect(parseRetryAfter(value, NOW)).toBe(expected)
  })

  it('When the value is a future HTTP-date then it converts to remaining seconds', () => {
    expect(parseRetryAfter('Wed, 11 Nov 2026 13:00:00 GMT', NOW)).toBe(3600)
  })

  it('When the value is a past HTTP-date then it is treated as absent', () => {
    expect(parseRetryAfter('Wed, 11 Nov 2026 11:30:00 GMT', NOW)).toBeNull()
  })

  it('When the value is an unparseable date-like string then it is treated as absent', () => {
    expect(parseRetryAfter('not-a-date', NOW)).toBeNull()
  })
})
