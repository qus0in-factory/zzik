import { describe, expect, it } from 'vitest'
import { codexWindowLabel } from '@domain/usage/codex-labels'

function labelFor(limitWindowSeconds: number | null, insideRateLimit = true, path = 'rate_limit.primary_window') {
  const topKey = path.split('.')[0]
  return codexWindowLabel({ path, topKey, limitWindowSeconds, insideRateLimit })
}

describe('Given a codex window length (D6 라벨)', () => {
  it.each([
    [18000, '5시간 한도'],
    [604800, '주간 한도'],
  ] as const)('When the length is %s seconds then the label is %s without an unverified badge', (seconds, label) => {
    expect(labelFor(seconds)).toEqual({ label, unknown: false })
  })

  it.each([
    [3600, '1시간 한도'],
    [10800, '3시간 한도'],
    [172800, '2일 한도'],
    [90000, '1일 한도'],
  ] as const)('When the length is %s seconds then the label is derived and marked unverified', (seconds, label) => {
    expect(labelFor(seconds)).toEqual({ label, unknown: true })
  })

  it('When the length is missing then the json path is used as the label and marked unverified', () => {
    expect(labelFor(null)).toEqual({ label: 'rate_limit.primary_window', unknown: true })
  })

  it('When the length is not a sane number then it is treated as missing', () => {
    expect(labelFor(0).unknown).toBe(true)
    expect(labelFor(-60).label).toBe('rate_limit.primary_window')
    expect(labelFor(Number.NaN).label).toBe('rate_limit.primary_window')
  })
})

describe('Given a windows bucket outside rate_limit', () => {
  it('When the top level key is not rate_limit then the label is prefixed with the readable key and marked unverified', () => {
    expect(codexWindowLabel({ path: 'code_review_rate_limit', topKey: 'code_review_rate_limit', limitWindowSeconds: 3600, insideRateLimit: false })).toEqual({
      label: 'Code Review Rate Limit · 1시간 한도',
      unknown: true,
    })
  })

  it('When the window is nested in an array then the readable top level key is still used', () => {
    expect(codexWindowLabel({ path: 'mcp.buckets[0]', topKey: 'mcp', limitWindowSeconds: 18000, insideRateLimit: false })).toEqual({
      label: 'Mcp · 5시간 한도',
      unknown: true,
    })
  })

  it('When a known length appears outside rate_limit then the badge still marks it unverified', () => {
    expect(codexWindowLabel({ path: 'extra.weekly', topKey: 'extra', limitWindowSeconds: 604800, insideRateLimit: false })).toEqual({
      label: 'Extra · 주간 한도',
      unknown: true,
    })
  })
})
