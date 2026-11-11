import { describe, it, expect } from 'vitest'
import { getUsage } from '../../../../worker/app/usage/get-usage'
import { FakeStore } from '../../../fakes/worker-ports'
describe('Given the usage use case', () => {
  it.each([null, '{"schema":1}', '{}'])('When reading %s Then it interprets the stored value', async (value) => {
    const result = await getUsage(new FakeStore({ ok: true, value }))
    expect(result).toEqual(value === '{}' ? { ok: false, reason: 'snapshot_corrupt' } : { ok: true, snapshot: value ? { schema: 1 } : null })
  })
  it('When storage fails Then it preserves the failure', async () => {
    expect(await getUsage(new FakeStore({ ok: false, reason: 'storage_unavailable' }))).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
