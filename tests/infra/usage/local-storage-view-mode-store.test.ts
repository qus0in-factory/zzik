import { describe, expect, it } from 'vitest'
import { createLocalStorageViewModeStore, parseStoredViewMode, serializeViewMode, VIEW_MODE_STORAGE_KEY } from '@infra/usage/local-storage-view-mode-store'

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
}

describe('Given the localStorage view mode adapter (브라우저별)', () => {
  it('Then the key and format are versioned', () => {
    expect(VIEW_MODE_STORAGE_KEY).toBe('zzik:view-mode:v1')
    expect(JSON.parse(serializeViewMode('list'))).toEqual({ version: 1, mode: 'list' })
  })
  it('When saved and loaded Then the mode round-trips', () => {
    const storage = memory()
    const store = createLocalStorageViewModeStore(storage)
    store.save('list')
    expect(JSON.parse(storage.data.get(VIEW_MODE_STORAGE_KEY) ?? '')).toEqual({ version: 1, mode: 'list' })
    expect(store.load()).toBe('list')
  })
  it.each([null, '', '{oops', '[]', '"list"', '{"version":2,"mode":"list"}', '{"version":1}'])('When the stored text is %j Then load is null', (text) => {
    expect(parseStoredViewMode(text)).toBeNull()
  })
  it('When storage is missing or throws Then it never throws and loads null', () => {
    const throwing = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('x') } }
    for (const source of [null, throwing]) {
      const store = createLocalStorageViewModeStore(source)
      expect(store.load()).toBeNull()
      expect(() => store.save('list')).not.toThrow()
    }
  })
})
