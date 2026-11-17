import { describe, expect, it } from 'vitest'
import { resolveUsageReadStore } from '../../../../worker/infra/usage/read-store'

describe('Given the D1 read flag is still off in A', () => {
  it('When unspecified Then the runtime stays on Postgres', () => {
    expect(resolveUsageReadStore({})).toEqual({ ok: true, store: 'd1' })
    expect(resolveUsageReadStore({ USAGE_READ_STORE: '' })).toEqual({ ok: true, store: 'd1' })
  })
  it('When explicitly selected Then only postgres or d1 are accepted', () => {
    expect(resolveUsageReadStore({ USAGE_READ_STORE: 'postgres' })).toEqual({ ok: false, reason: 'storage_unavailable' })
    expect(resolveUsageReadStore({ USAGE_READ_STORE: 'd1' })).toEqual({ ok: true, store: 'd1' })
    expect(resolveUsageReadStore({ USAGE_READ_STORE: 'D1' })).toEqual({ ok: false, reason: 'storage_unavailable' })
    expect(resolveUsageReadStore({ USAGE_READ_STORE: 'auto' })).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
