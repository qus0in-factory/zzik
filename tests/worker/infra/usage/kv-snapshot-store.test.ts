import { describe, it, expect } from 'vitest'
import { KvSnapshotStore } from '../../../../worker/infra/usage/kv-snapshot-store'
describe('Given the KV adapter', () => {
  it('When reading a provider Then it uses the exact key from the table and preserves text', async () => {
    const keys: string[] = []
    const store = new KvSnapshotStore({ async get(key) { keys.push(key); return '{"schema":1}' } })
    expect(await store.read('claude')).toEqual({ ok: true, value: '{"schema":1}' }); expect(keys).toEqual(['usage:claude'])
    expect(await store.read('codex')).toEqual({ ok: true, value: '{"schema":1}' }); expect(keys).toEqual(['usage:claude', 'usage:codex'])
  })
  it('When KV throws Then it returns a storage failure', async () => {
    expect(await new KvSnapshotStore({ async get() { throw new Error('private detail') } }).read('claude')).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
