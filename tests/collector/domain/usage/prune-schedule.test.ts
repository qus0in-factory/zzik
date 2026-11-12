import { describe, it, expect } from 'vitest'
import { shouldPrune } from '../../../../collector/domain/usage/prune-schedule.mjs'
describe('Given a daily retention checkpoint', () => {
  it('When at least 24 hours elapsed Then prunes, including first or invalid checkpoint', () => {
    const now=Date.parse('2026-11-13T00:00:00Z')
    expect(shouldPrune(null,now)).toBe(true)
    expect(shouldPrune('invalid',now)).toBe(true)
    expect(shouldPrune('2026-11-12T00:00:01Z',now)).toBe(false)
    expect(shouldPrune('2026-11-12T00:00:00Z',now)).toBe(true)
  })
})
