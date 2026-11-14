import { describe, expect, it } from 'vitest'
import { createLocalStorageOrderStore, parseStoredOrder, PROVIDER_ORDER_STORAGE_KEY, serializeOrder } from '@infra/usage/local-storage-order-store'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

describe('Given the localStorage order store (브라우저별 저장)', () => {
  it('Then the key is versioned', () => {
    expect(PROVIDER_ORDER_STORAGE_KEY).toBe('zzik:provider-order:v1')
  })
  it('When saved and loaded Then the order round-trips through the versioned JSON', () => {
    const storage = memoryStorage()
    const store = createLocalStorageOrderStore(storage)
    store.save(['codex', 'claude'])
    expect(JSON.parse(storage.data.get(PROVIDER_ORDER_STORAGE_KEY) ?? '')).toEqual({ version: 1, order: ['codex', 'claude'] })
    expect(store.load()).toEqual(['codex', 'claude'])
  })
  it('When cleared Then nothing is stored and load returns null', () => {
    const storage = memoryStorage({ [PROVIDER_ORDER_STORAGE_KEY]: '{"version":1,"order":["claude"]}' })
    const store = createLocalStorageOrderStore(storage)
    store.clear()
    expect(store.load()).toBeNull()
  })
  it('When the stored text is corrupt or another version Then load is null', () => {
    expect(createLocalStorageOrderStore(memoryStorage({ [PROVIDER_ORDER_STORAGE_KEY]: '{oops' })).load()).toBeNull()
    expect(createLocalStorageOrderStore(memoryStorage({ [PROVIDER_ORDER_STORAGE_KEY]: '{"version":9,"order":[]}' })).load()).toBeNull()
  })
  it('When storage is unavailable or throws (private mode, quota) Then it never throws and acts as empty', () => {
    expect(() => createLocalStorageOrderStore(null).save(['claude'])).not.toThrow()
    expect(createLocalStorageOrderStore(null).load()).toBeNull()
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') } }
    const store = createLocalStorageOrderStore(throwing)
    expect(store.load()).toBeNull()
    expect(() => store.save(['claude'])).not.toThrow()
    expect(() => store.clear()).not.toThrow()
  })
  it('When serialized and parsed Then the same order comes back with a schema version', () => {
    expect(JSON.parse(serializeOrder(['codex', 'claude']))).toEqual({ version: 1, order: ['codex', 'claude'] })
    expect(parseStoredOrder(serializeOrder(['codex', 'claude']))).toEqual(['codex', 'claude'])
  })
  it.each([null, '', 'not json', '[]', '{"version":2,"order":["claude"]}', '{"version":1}', '{"version":1,"order":"claude"}'])('When the stored text is %j Then null (falls back to the default)', (text) => {
    expect(parseStoredOrder(text)).toBeNull()
  })
})
