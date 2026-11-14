import { describe, expect, it } from 'vitest'
import { createKeyValueStorage } from '@infra/usage/browser-storage'

function memoryStorage() {
  const data = new Map<string, string>()
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) }
}

describe('Given the key-value storage adapter (localStorage·sessionStorage)', () => {
  it('When used normally Then get/set/remove work and set reports success', () => {
    const storage = createKeyValueStorage(memoryStorage())
    expect(storage.get('k')).toBeNull()
    expect(storage.set('k', 'v')).toBe(true)
    expect(storage.get('k')).toBe('v')
    storage.remove('k')
    expect(storage.get('k')).toBeNull()
  })
  it('When the storage is missing or throws (private mode, quota, blocked) Then get is null, set is false and nothing throws', () => {
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') } }
    for (const source of [null, throwing]) {
      const storage = createKeyValueStorage(source)
      expect(storage.get('k')).toBeNull()
      expect(storage.set('k', 'v')).toBe(false)
      expect(() => storage.remove('k')).not.toThrow()
    }
  })
})
