import { describe, it, expect } from 'vitest'
import { createCardActivityStore } from '@app/usage/card-activity-store'
import { activeLap } from '../../../src/app/usage/activity'

describe('Given a card activity store shared above the cards', () => {
  it('When the same card id is observed again after an unmount Then the prior value is still the baseline', () => {
    const store = createCardActivityStore()
    const first = store.observe('five_hour', 10, 0)
    expect(activeLap(first, 60_000)).toBeNull()

    const second = store.observe('five_hour', 12, 60_000)
    expect(activeLap(second, 60_000)).toBe(4)
  })

  it('When two card ids alternate Then each keeps its own baseline', () => {
    const store = createCardActivityStore()
    store.observe('five_hour', 10, 0)
    store.observe('seven_day', 40, 0)

    expect(activeLap(store.observe('five_hour', 12, 60_000), 60_000)).toBe(4)
    expect(activeLap(store.observe('seven_day', 40, 60_000), 60_000)).toBeNull()
  })

  it('When a recorded value goes missing Then a later value needs a new baseline', () => {
    const store = createCardActivityStore()
    store.observe('five_hour', 10, 0)
    store.observe('five_hour', null, 1)

    expect(activeLap(store.observe('five_hour', 20, 2), 2)).toBeNull()
  })
})
