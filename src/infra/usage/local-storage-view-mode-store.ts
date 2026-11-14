export const VIEW_MODE_STORAGE_KEY = 'zzik:view-mode:v1'
/** 저장 형식의 스키마 버전. 모르는 버전은 없는 값으로 취급한다. */
export const VIEW_MODE_SCHEMA_VERSION = 1

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** app의 ViewModePort와 구조가 같다(infra는 app을 import하지 않는다). */
interface ViewModeAdapter {
  load(): unknown
  save(mode: 'grid' | 'list'): void
}

export function serializeViewMode(mode: 'grid' | 'list'): string {
  return JSON.stringify({ version: VIEW_MODE_SCHEMA_VERSION, mode })
}

/** 저장 문자열 → mode 값(검증 전). 형식·버전이 맞지 않으면 null. */
export function parseStoredViewMode(text: string | null): unknown {
  if (text === null || text === '') return null
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    return record.version === VIEW_MODE_SCHEMA_VERSION && 'mode' in record ? record.mode : null
  } catch {
    return null
  }
}

/** 브라우저별 localStorage 어댑터. 저장소가 없거나 막혀도 던지지 않는다(보기 방식은 편의 기능). */
export function createLocalStorageViewModeStore(storage: StorageLike | null, key: string = VIEW_MODE_STORAGE_KEY): ViewModeAdapter {
  return {
    load() {
      try {
        return parseStoredViewMode(storage?.getItem(key) ?? null)
      } catch {
        return null
      }
    },
    save(mode) {
      try {
        storage?.setItem(key, serializeViewMode(mode))
      } catch {
        /* 저장 실패는 무시 */
      }
    },
  }
}
