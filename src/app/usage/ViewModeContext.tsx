import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { createViewModeStore } from './view-mode-store'
import type { ViewModeState, ViewModeStoreApi } from './view-mode-store'

/** Provider 밖(테스트·정적 렌더)에서는 저장하지 않는 기본 스토어(카드)를 쓴다. */
const ViewModeContext = createContext<ViewModeStoreApi>(createViewModeStore(null))

export function ViewModeProvider({ store, children }: { store: ViewModeStoreApi; children: ReactNode }): ReactNode {
  return <ViewModeContext.Provider value={store}>{children}</ViewModeContext.Provider>
}

export function useViewMode(): ViewModeState {
  return useStore(useContext(ViewModeContext))
}
