import { createStore } from 'zustand'
import type { StoreApi } from 'zustand'
import { normalizeViewMode } from './view-mode'
import type { ViewMode, ViewModePort } from './view-mode'

/**
 * 보기 방식 클라이언트 상태(스택 부록 A5: persist 미들웨어는 쓰지 않는다). 정규화는 순수 함수가 하고,
 * 스토어는 그것을 호출해 상태를 바꾼 뒤 주입된 포트(infra: localStorage)로 저장한다.
 */
export interface ViewModeState {
  mode: ViewMode
  setMode(mode: ViewMode): void
}
export type ViewModeStoreApi = StoreApi<ViewModeState>

export function createViewModeStore(port: ViewModePort | null): ViewModeStoreApi {
  return createStore<ViewModeState>()((set, get) => ({
    mode: normalizeViewMode(port?.load() ?? null),
    setMode: (mode) => {
      const next = normalizeViewMode(mode)
      if (next === get().mode) return
      set({ mode: next })
      port?.save(next)
    },
  }))
}
