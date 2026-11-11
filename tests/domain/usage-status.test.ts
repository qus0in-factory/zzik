import { describe, expect, it } from 'vitest'
import { getUsageStatus } from '@domain/usage-status'

describe('Given a usage percentage', () => {
  it.each([ [0, 'normal'], [79.99, 'normal'], [80, 'warn'], [99.99, 'warn'], [100, 'limit'], [120, 'limit'] ] as const)(
    'When usage is %s percent Then the status is %s', (percentage, status) => {
      expect(getUsageStatus(percentage)).toBe(status)
    },
  )
  it.each([-1, NaN, Infinity, -Infinity])('When usage is invalid (%s) Then it is rejected', (percentage) => {
    expect(() => getUsageStatus(percentage)).toThrow(RangeError)
  })
})
