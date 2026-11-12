import { describe, it, expect } from 'vitest'
import { usageActivity } from '../../../src/domain/usage/activity'
describe('Given consecutive percentages', () => {
  it('When values change Then uses absolute delta and clamps speed', () => {
    expect(usageActivity(10, 12)).toEqual({ delta: 2, lapSeconds: 4 })
    expect(usageActivity(90, 0)).toEqual({ delta: 90, lapSeconds: 0.8 })
    expect(usageActivity(1, 1.1)?.lapSeconds).toBe(8)
  })
  it('When missing or unchanged Then does not run', () => {
    for (const [a, b] of [[null, 1], [1, null], [1, 1]] as const) expect(usageActivity(a, b)).toBeNull()
  })
})
