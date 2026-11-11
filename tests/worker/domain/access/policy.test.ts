import { describe, it, expect } from 'vitest'
import { isAllowed } from '../../../../worker/domain/access/policy'
describe('Given an owner email policy', () => {
  it.each(['owner@example.com', 'other@example.com', undefined])('When email is %s Then only the exact owner is allowed', (email) => {
    expect(isAllowed({ email }, 'owner@example.com')).toBe(email === 'owner@example.com')
  })
})
