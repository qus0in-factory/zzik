import type { KeyValueStorage } from '@domain/usage/history/ports'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * localStorage·sessionStorage를 동기 KeyValueStorage 포트로 감싼다(ADR 0.7 6.5절). 저장소가 없거나 막혀 있어도
 * (비공개 모드·용량 초과·차단) 던지지 않는다 — get은 null, set은 false.
 */
export function createKeyValueStorage(storage: StorageLike | null): KeyValueStorage {
  return {
    get(key) {
      try {
        return storage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        if (storage === null) return false
        storage.setItem(key, value)
        return true
      } catch {
        return false
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key)
      } catch {
        /* 무시 */
      }
    },
  }
}

/** 실제 브라우저 저장소(접근 자체가 막히면 null). */
export function browserLocalKeyValue(): KeyValueStorage {
  try {
    return createKeyValueStorage(typeof window === 'undefined' ? null : window.localStorage)
  } catch {
    return createKeyValueStorage(null)
  }
}

export function browserSessionKeyValue(): KeyValueStorage {
  try {
    return createKeyValueStorage(typeof window === 'undefined' ? null : window.sessionStorage)
  } catch {
    return createKeyValueStorage(null)
  }
}

/** 다른 탭이 `key`를 바꾸면 알린다(`storage` 이벤트). 구독 해제 함수를 돌려준다. 범례 설정의 탭 간 동기화에 쓴다. */
export function subscribeStorageKey(key: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: StorageEvent): void => {
    if (event.key === key || event.key === null) onChange()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
