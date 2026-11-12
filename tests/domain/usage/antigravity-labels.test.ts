import { describe, it, expect } from 'vitest'
import { antigravityLabel, antigravityCycleSeconds } from '@domain/usage/antigravity-labels'
describe('Given Antigravity windows observed in the masked probe', () => {
  it('When known Then supplies a fixed label and explicit duration', () => {
    expect(antigravityLabel('Claude and GPT models', '5h')).toEqual({ label: 'Claude and GPT models · 5시간 한도', unknown: false })
    expect(antigravityLabel('Group', 'weekly')).toEqual({ label: 'Group · 주간 한도', unknown: false })
    expect(antigravityCycleSeconds('5h')).toBe(18000)
    expect(antigravityCycleSeconds('weekly')).toBe(604800)
  })
  it('When unknown Then does not infer its duration', () => {
    expect(antigravityLabel('Group', 'monthly')).toEqual({ label: 'Group · monthly 한도', unknown: true })
    expect(antigravityCycleSeconds('monthly')).toBeNull()
  })
})
