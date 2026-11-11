import { describe, it, expect } from 'vitest'
import { KvSnapshotStore } from '../../../../worker/infra/usage/kv-snapshot-store'
describe('Given the KV adapter', () => {
  it('When reading Then it uses the exact key and preserves text', async () => {
    const keys: string[] = []
    const store = new KvSnapshotStore({ async get(key) { keys.push(key); return '{"schema":1}' } })
    expect(await store.read()).toEqual({ ok: true, value: '{"schema":1}' }); expect(keys).toEqual(['usage:claude'])
  })
  it('When KV throws Then it returns a storage failure', async () => {
    expect(await new KvSnapshotStore({ async get() { throw new Error('private detail') } }).read()).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
