import { describe, it, expect } from 'vitest'
import { usageActivity } from '../../../src/domain/usage/activity'
describe('Given consecutive percentages', () => {
  it('When values change Then uses absolute delta and clamps speed', () => {
    expect(usageActivity(10, 12)).toEqual({ delta: 2, lapSeconds: 0.6 })
    expect(usageActivity(90, 95)).toEqual({ delta: 5, lapSeconds: 0.25 })
    expect(usageActivity(1, 1.1)?.lapSeconds).toBe(1.2)
  })
  it('When missing or unchanged Then does not run', () => {
    for (const [a, b] of [[null, 1], [1, null], [1, 1]] as const) expect(usageActivity(a, b)).toBeNull()
  })
  it('When current is zero Then does not run (0% is hidden)', () => {
    expect(usageActivity(10, 0)).toBeNull()
    expect(usageActivity(0, 0)).toBeNull()
  })
})
