import { describe, expect, it } from 'vitest'
import { getUsageStatus, statusOf } from '@domain/usage-status'

describe('Given a usage percentage', () => {
  it.each([ [0, 'normal'], [79.9, 'normal'], [79.99, 'normal'], [80, 'warn'], [89, 'warn'], [90, 'warn'], [99.9, 'warn'], [99.99, 'warn'], [100, 'limit'], [120, 'limit'] ] as const)(
    'When usage is %s percent Then the status is %s', (percentage, status) => {
      expect(getUsageStatus(percentage)).toBe(status)
    },
  )
  it.each([-1, NaN, Infinity, -Infinity])('When usage is invalid (%s) Then it is rejected', (percentage) => {
    expect(() => getUsageStatus(percentage)).toThrow(RangeError)
  })
})

describe('Given a possibly missing usage percentage', () => {
  it('When the percentage is null or undefined Then the null-safe wrapper is unknown', () => {
    expect(statusOf(null)).toBe('unknown')
    expect(statusOf(undefined)).toBe('unknown')
  })
  it.each([ [0, 'normal'], [37, 'normal'], [85, 'warn'], [104, 'limit'] ] as const)('When the percentage is %s Then the wrapper reuses the fixed thresholds', (percentage, status) => {
    expect(statusOf(percentage)).toBe(status)
  })
})
