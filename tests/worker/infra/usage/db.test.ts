import { describe, expect, it } from 'vitest'
import { createDb } from '../../../../worker/infra/usage/db'
describe('Given a per-request DB factory', () => {
  it('When DB_URL is missing Then does not allocate a connection', () => {
    let calls = 0
    expect(createDb({}, () => { calls++; throw new Error('unexpected') })).toBeNull()
    expect(calls).toBe(0)
  })
  it('When constructing a Workers connection Then keeps TLS settings in the URL and uses supported SCRAM within the HTTP timeout', () => {
    const url = 'postgres://synthetic/db?sslmode=require&channel_binding=require'
    let received: unknown
    createDb({ DB_URL: url }, (...args) => { received = args; return { db: null, async close() {} } })
    expect(received).toEqual([url, { max: 1, prepare: false, connect_timeout: 5, channel_binding: 'prefer' }])
  })
  it('When connection creation fails Then does not leak configuration', () => {
    expect(createDb({ DB_URL: 'fake' }, () => { throw new Error('private-url') })).toBeNull()
  })
})
