import { describe, it, expect } from 'vitest'
import { getUsage } from '../../../../worker/app/usage/get-usage'
import { FakeStore } from '../../../fakes/worker-ports'
describe('Given the usage use case', () => {
  it.each([null, '{"schema":1,"provider":"claude"}', '{"schema":1,"provider":"codex"}'])('When reading %s as claude Then the provider must match the request', async (value) => {
    const stored = value === null ? null : JSON.parse(value)
    const store = new FakeStore({ ok: true, value })
    const result = await getUsage(store, 'claude')
    const mismatch = stored !== null && stored.provider !== 'claude'
    expect(result).toEqual(mismatch ? { ok: false, reason: 'snapshot_corrupt' } : { ok: true, snapshot: stored })
    expect(store.providersRead).toEqual(['claude'])
  })
  it('When storage fails Then it preserves the failure', async () => {
    expect(await getUsage(new FakeStore({ ok: false, reason: 'storage_unavailable' }), 'claude')).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
