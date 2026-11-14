import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { createIdbHistoryCache } from '@infra/usage/idb-history-cache'
import { createRecord } from '@domain/usage/history/record'

const NOW = '2026-11-14T12:00:00.000Z'
const record = (provider: 'claude' | 'codex', cursor: string | null = null) => ({ ...createRecord(provider, NOW), cursor })

describe('Given the IndexedDB history cache (zzik / usage-history)', () => {
  it('When nothing is stored Then read is null and the list is empty', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    expect(await cache.read('claude')).toBeNull()
    expect(await cache.listProviders()).toEqual([])
  })
  it('When a record is updated Then it is readable, listed, and removable', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    expect(await cache.update('claude', () => record('claude', 'c1'))).toEqual({ ok: true, written: true })
    expect(await cache.update('codex', () => record('codex'))).toEqual({ ok: true, written: true })
    expect((await cache.read('claude'))?.cursor).toBe('c1')
    expect((await cache.listProviders()).sort()).toEqual(['claude', 'codex'])
    await cache.remove('claude')
    expect(await cache.read('claude')).toBeNull()
  })
  it('When mutate returns null Then nothing is written (I4) and the current value is passed to mutate', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    await cache.update('claude', () => record('claude', 'c1'))
    let seen: string | null | undefined
    expect(await cache.update('claude', (current) => { seen = current?.cursor; return null })).toEqual({ ok: true, written: false })
    expect(seen).toBe('c1')
    expect((await cache.read('claude'))?.cursor).toBe('c1')
  })
  it('When mutate throws Then the stored value is untouched and the result is unavailable', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    await cache.update('claude', () => record('claude', 'c1'))
    const result = await cache.update('claude', () => { throw new Error('boom') })
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
    expect((await cache.read('claude'))?.cursor).toBe('c1')
  })
  it('When two updates run back to back Then each sees the previous result (single read-modify-write transaction)', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    await Promise.all([1, 2, 3].map((n) => cache.update('claude', (current) => ({ ...(current ?? record('claude')), cursor: `${(current?.cursor ?? '') + n}` }))))
    expect((await cache.read('claude'))?.cursor).toHaveLength(3)
  })
  it('When IndexedDB is not available Then it falls back to memory and keeps working', async () => {
    const cache = createIdbHistoryCache(null)
    await cache.update('claude', () => record('claude', 'm1'))
    expect((await cache.read('claude'))?.cursor).toBe('m1')
    expect(await cache.listProviders()).toEqual(['claude'])
    await cache.remove('claude')
    expect(await cache.read('claude')).toBeNull()
  })
  it('When opening the database fails Then it also falls back to memory', async () => {
    const broken = { open: () => { throw new Error('blocked') } } as unknown as IDBFactory
    const cache = createIdbHistoryCache(broken)
    await cache.update('claude', () => record('claude', 'm2'))
    expect((await cache.read('claude'))?.cursor).toBe('m2')
  })
  it('Then the stored value is a structured clone (the caller cannot mutate the stored record)', async () => {
    const cache = createIdbHistoryCache(new IDBFactory())
    await cache.update('claude', () => record('claude', 'c1'))
    const first = await cache.read('claude')
    if (first) first.cursor = 'tampered'
    expect((await cache.read('claude'))?.cursor).toBe('c1')
  })
})
