import { describe, expect, it } from 'vitest'
import { rebaseIsoFields } from '@domain/usage/rebase-iso-fields'
import { rebaseAntigravityResetsAt } from '@domain/usage/antigravity-calibration'

const from = new Date('2026-11-11T12:00:00Z')
const to = new Date('2026-11-21T12:00:00Z')

describe('Given rebaseIsoFields', () => {
  it('When keys are listed Then only those ISO fields move by the delta, at any depth', () => {
    const raw = { a: { until: '2026-12-01T00:00:00Z', other: '2026-12-01T00:00:00Z' }, list: [{ until: '2026-11-12T00:00:00Z' }], until2: 'x' }
    expect(rebaseIsoFields(raw, ['until'], from, to)).toEqual({
      a: { until: '2026-12-11T00:00:00.000Z', other: '2026-12-01T00:00:00Z' },
      list: [{ until: '2026-11-22T00:00:00.000Z' }],
      until2: 'x',
    })
  })
  it('When a listed field is not a time Then it is left alone', () => {
    expect(rebaseIsoFields({ until: 'soon', n: 1 }, ['until'], from, to)).toEqual({ until: 'soon', n: 1 })
  })
  it('When called through the Antigravity wrapper Then behavior is unchanged', () => {
    expect(rebaseAntigravityResetsAt({ resetTime: '2026-11-11T14:30:00Z', other: '2026-11-11T14:30:00Z' }, from, to)).toEqual({
      resetTime: '2026-11-21T14:30:00.000Z',
      other: '2026-11-11T14:30:00Z',
    })
  })
})
