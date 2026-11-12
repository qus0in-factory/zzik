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
  it('When an active running cat transitions to zero or null Then stops immediately (lapSeconds null)', () => {
    const first = observeActivity(undefined, 10, 0)
    const running = observeActivity(first, 12, 60_000)
    expect(activeLap(running, 60_000)).toBe(0.6)

    // 10 -> 12 -> 0: 활성 상태에서 0으로 변할 때 즉시 정지
    const toZero = observeActivity(running, 0, 120_000)
    expect(activeLap(toZero, 120_000)).toBeNull()
    expect(toZero.lapSeconds).toBeNull()

    // 0 이후 새 양수 변화로 재활성화
    const reactivated = observeActivity(toZero, 15, 180_000)
    expect(activeLap(reactivated, 180_000)).toBe(0.25)

    // 활성 상태에서 null로 변할 때 즉시 정지
    const toNull = observeActivity(reactivated, null, 240_000)
    expect(activeLap(toNull, 240_000)).toBeNull()
    expect(toNull.lapSeconds).toBeNull()
  })
})
