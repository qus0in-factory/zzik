import { describe, it, expect } from 'vitest'
import { observeActivity, activeLap } from '../../../src/app/usage/activity'
describe('Given card observation history', () => {
  it('When first loaded Then rests; changes run for exactly five minutes', () => {
    const first = observeActivity(undefined, 10, 0)
    expect(activeLap(first, 0)).toBeNull()
    const changed = observeActivity(first, 12, 60_000)
    expect(activeLap(changed, 359_999)).toBe(0.6)
    expect(activeLap(changed, 360_000)).toBeNull()
    expect(activeLap(observeActivity(changed, 12, 120_000), 360_000)).toBeNull()
    expect(activeLap(observeActivity(changed, 22, 120_000), 400_000)).toBe(0.25)
  })
  it('When a value becomes missing or zero Then stops and needs a new baseline', () => {
    const missing = observeActivity(observeActivity(undefined, 10, 0), null, 1)
    expect(activeLap(missing, 1)).toBeNull()
    expect(activeLap(observeActivity(missing, 20, 2), 2)).toBeNull()

    const zero = observeActivity(observeActivity(undefined, 10, 0), 0, 1)
    expect(activeLap(zero, 1)).toBeNull()
  })
})
