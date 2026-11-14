export const PROVIDER_ORDER_STORAGE_KEY = 'zzik:provider-order:v1'
/** 저장 형식의 스키마 버전. 형식이 바뀌면 올리고, 모르는 버전은 없는 값으로 취급한다. */
export const PROVIDER_ORDER_SCHEMA_VERSION = 1

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** app의 ProviderOrderPort와 구조가 같다(infra는 app을 import하지 않는다). */
interface OrderPort {
  load(): unknown[] | null
  save(order: readonly string[]): void
  clear(): void
}

export function serializeOrder(order: readonly string[]): string {
  return JSON.stringify({ version: PROVIDER_ORDER_SCHEMA_VERSION, order })
}

/** 저장 문자열 → 순서 배열. 형식·버전이 맞지 않으면 null. */
export function parseStoredOrder(text: string | null): unknown[] | null {
  if (text === null || text === '') return null
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return record.version === PROVIDER_ORDER_SCHEMA_VERSION && Array.isArray(record.order) ? record.order : null
  } catch {
    return null
  }
}

/**
 * 브라우저 localStorage에 제공자 순서를 저장하는 어댑터. 저장소가 없거나(null) 막혀 있어도(프라이빗 모드·용량 초과)
 * 던지지 않고 빈 저장소처럼 동작한다 — 순서는 편의 기능이라 실패해도 화면이 멈추면 안 된다.
 */
export function createLocalStorageOrderStore(storage: StorageLike | null, key: string = PROVIDER_ORDER_STORAGE_KEY): OrderPort {
  return {
    load() {
      try {
        return parseStoredOrder(storage?.getItem(key) ?? null)
      } catch {
        return null
      }
    },
    save(order) {
      try {
        storage?.setItem(key, serializeOrder(order))
      } catch {
        /* 저장 실패는 무시 */
      }
    },
    clear() {
      try {
        storage?.removeItem(key)
      } catch {
        /* 무시 */
      }
    },
  }
}

/** 실제 브라우저 저장소(접근 자체가 막히면 null). */
export function browserLocalStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
