import { describe, expect, it } from 'vitest'
import { aggregateUsageLevel, usageLevelOf } from '@domain/usage/level'

describe('Given a parsed percentage', () => {
  it.each([
    [0, 'normal'],
    [79.9, 'normal'],
    [80, 'warn'],
    [89, 'warn'],
    [90, 'warn'],
    [99.9, 'warn'],
    [100, 'limit'],
    [104, 'limit'],
  ] as const)('When usage is %s percent then the level is %s', (percent, level) => {
    expect(usageLevelOf(percent)).toBe(level)
  })

  it('When the percentage is missing then the level is unknown', () => {
    expect(usageLevelOf(null)).toBe('unknown')
  })
})

describe('Given report status aggregation', () => {
  it('When an active limit exists then the report is limit', () => {
    expect(aggregateUsageLevel([{ status: 'limit', expired: false }, { status: 'normal', expired: false }])).toBe('limit')
  })

  it('When only an active warn exists then the report is warn', () => {
    expect(aggregateUsageLevel([{ status: 'warn', expired: false }, { status: 'unknown', expired: false }])).toBe('warn')
  })

  it('When values exist and none reaches a threshold then the report is normal', () => {
    expect(aggregateUsageLevel([{ status: 'normal', expired: false }, { status: 'unknown', expired: false }])).toBe('normal')
  })

  it('When every entry is expired then the report falls back to normal like an idle value', () => {
    expect(aggregateUsageLevel([{ status: 'limit', expired: true }, { status: 'warn', expired: true }])).toBe('normal')
  })

  it('When nothing has a value then the report is unknown', () => {
    expect(aggregateUsageLevel([{ status: 'unknown', expired: false }])).toBe('unknown')
    expect(aggregateUsageLevel([])).toBe('unknown')
    expect(aggregateUsageLevel([{ status: 'unknown', expired: true }])).toBe('unknown')
  })
})
