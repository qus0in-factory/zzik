import { describe, expect, it } from 'vitest'
import { createDb } from '../../../../worker/infra/usage/db'
describe('Given a per-request DB factory', () => {
  it('When DB_URL is missing Then does not allocate a connection', () => {
    let calls = 0
    expect(createDb({}, () => { calls++; throw new Error('unexpected') })).toBeNull()
    expect(calls).toBe(0)
  })
  it('When connection creation fails Then does not leak configuration', () => {
    expect(createDb({ DB_URL: 'fake' }, () => { throw new Error('private-url') })).toBeNull()
  })
})
