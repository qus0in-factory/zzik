import type { HistoryCacheStore, HistoryCacheUpdateResult } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'

const DB_NAME = 'zzik'
const STORE = 'usage-history'

/**
 * IndexedDB `zzik` / `usage-history`(keyPath `provider`) 어댑터(ADR 0.7 6.1·6.5절). 제공자별 레코드를 읽기·갱신·삭제·목록으로 다룬다.
 * `update`는 읽기-변경-쓰기를 한 트랜잭션에서 하고, `mutate`는 동기 순수 함수다(I5: 트랜잭션 안에서 네트워크를 기다리지 않는다).
 * 저장소 예외(비공개 모드, Quota, 차단)는 삼켜서 결과로 바꾼다. IndexedDB를 못 열면 메모리 Map으로 대체한다.
 */
export function createIdbHistoryCache(factory: IDBFactory | null): HistoryCacheStore {
  const memory = new Map<UsageProvider, HistoryCacheRecord>()
  let opening: Promise<IDBDatabase | null> | null = null

  const open = (): Promise<IDBDatabase | null> => {
    if (factory === null) return Promise.resolve(null)
    opening ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = factory.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'provider' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return opening
  }

  return {
    async read(provider) {
      const db = await open()
      if (db === null) return memory.has(provider) ? structuredClone(memory.get(provider) as HistoryCacheRecord) : null
      return new Promise((resolve) => {
        try {
          const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(provider)
          request.onsuccess = () => resolve((request.result as HistoryCacheRecord | undefined) ?? null)
          request.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
    },

    async update(provider, mutate): Promise<HistoryCacheUpdateResult> {
      const db = await open()
      if (db === null) {
        try {
          const next = mutate(memory.has(provider) ? structuredClone(memory.get(provider) as HistoryCacheRecord) : null)
          if (next === null) return { ok: true, written: false }
          memory.set(provider, structuredClone(next))
          return { ok: true, written: true }
        } catch {
          return { ok: false, reason: 'unavailable' }
        }
      }
      return new Promise((resolve) => {
        let written = false
        let failed: 'unavailable' | 'quota' | null = null
        try {
          const transaction = db.transaction(STORE, 'readwrite')
          const store = transaction.objectStore(STORE)
          const getRequest = store.get(provider)
          getRequest.onsuccess = () => {
            try {
              const next = mutate((getRequest.result as HistoryCacheRecord | undefined) ?? null)
              if (next === null) return
              store.put(structuredClone(next))
              written = true
            } catch {
              failed = 'unavailable'
              transaction.abort() // mutate가 던지면 아무것도 쓰지 않는다
            }
          }
          transaction.oncomplete = () => resolve({ ok: true, written })
          transaction.onabort = () => resolve({ ok: false, reason: failed ?? (transaction.error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable') })
          transaction.onerror = () => {
            failed ??= transaction.error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable'
          }
        } catch (error) {
          resolve({ ok: false, reason: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'unavailable' })
        }
      })
    },

    async remove(provider) {
      const db = await open()
      if (db === null) {
        memory.delete(provider)
        return
      }
      await new Promise<void>((resolve) => {
        try {
          const transaction = db.transaction(STORE, 'readwrite')
          transaction.objectStore(STORE).delete(provider)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => resolve()
        } catch {
          resolve()
        }
      })
    },

    async listProviders() {
      const db = await open()
      if (db === null) return [...memory.keys()]
      return new Promise((resolve) => {
        try {
          const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
          request.onsuccess = () => resolve(request.result as UsageProvider[])
          request.onerror = () => resolve([])
        } catch {
          resolve([])
        }
      })
    },
  }
}

/** 실제 브라우저의 IndexedDB(접근 자체가 막히면 null → 메모리 대체). */
export function browserIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}
