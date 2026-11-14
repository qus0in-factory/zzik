import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import { createProviderOrderStore } from './provider-order-store'
import type { ProviderOrderState, ProviderOrderStoreApi } from './provider-order-store'

/** Provider 밖(테스트·정적 렌더)에서는 저장하지 않는 기본 스토어를 쓴다. ui는 스토어를 직접 import하지 않고 아래 훅만 쓴다. */
const ProviderOrderContext = createContext<ProviderOrderStoreApi>(createProviderOrderStore(null))

/** 조립 루트가 만든 스토어(저장 포트 주입 완료)를 트리에 건다. */
export function ProviderOrderProvider({ store, children }: { store: ProviderOrderStoreApi; children: ReactNode }): ReactNode {
  return <ProviderOrderContext.Provider value={store}>{children}</ProviderOrderContext.Provider>
}

export function useProviderOrder(): ProviderOrderState {
  return useStore(useContext(ProviderOrderContext))
}
