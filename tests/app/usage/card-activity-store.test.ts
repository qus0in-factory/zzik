import { describe, it, expect } from 'vitest'
import { createCardActivityStore } from '@app/usage/card-activity-store'
import { activeLap } from '../../../src/app/usage/activity'

describe('Given a card activity store shared above the cards', () => {
  it('When the same card id is observed again after an unmount Then the prior value is still the baseline', () => {
    const store = createCardActivityStore()
    const first = store.observe('five_hour', 10, 0)
    expect(activeLap(first, 60_000)).toBeNull()

    const second = store.observe('five_hour', 12, 60_000)
    expect(activeLap(second, 60_000)).toBe(0.6)
  })

  it('When two card ids alternate Then each keeps its own baseline', () => {
    const store = createCardActivityStore()
    store.observe('five_hour', 10, 0)
    store.observe('seven_day', 40, 0)

    expect(activeLap(store.observe('five_hour', 12, 60_000), 60_000)).toBe(0.6)
    expect(activeLap(store.observe('seven_day', 40, 60_000), 60_000)).toBeNull()
  })

  it('When a recorded value goes missing Then a later value needs a new baseline', () => {
    const store = createCardActivityStore()
    store.observe('five_hour', 10, 0)
    store.observe('five_hour', null, 1)

    expect(activeLap(store.observe('five_hour', 20, 2), 2)).toBeNull()
  })

  it('When an active card drops to 0% and later unmounts and remounts Then it stays resting until new positive change', () => {
    const store = createCardActivityStore()
    store.observe('five_hour', 10, 0)
    const running = store.observe('five_hour', 12, 60_000)
    expect(activeLap(running, 60_000)).toBe(0.6)

    // 0% 관측으로 정지
    const zero = store.observe('five_hour', 0, 120_000)
    expect(activeLap(zero, 120_000)).toBeNull()

    // 언마운트 후 0%로 재마운트 시 여전히 정지
    const remountZero = store.observe('five_hour', 0, 180_000)
    expect(activeLap(remountZero, 180_000)).toBeNull()

    // 이후 새로운 양수 변화 발생 시 재활성화
    const reactivated = store.observe('five_hour', 5, 240_000)
    expect(activeLap(reactivated, 240_000)).toBe(0.25)
  })
})
