import { createStore } from 'zustand'
import type { StoreApi } from 'zustand'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { isDefaultOrder, moveProvider, normalizeOrder } from './provider-order'
import type { ProviderOrderPort } from './provider-order'

/**
 * 제공자 순서 클라이언트 상태(스택 부록 A5: Zustand는 클라이언트 상태만, persist 미들웨어는 쓰지 않는다).
 * 순서 계산은 순수 함수(provider-order.ts)가 하고, 스토어는 그 함수를 호출해 상태를 바꾼 뒤 주입된 포트(infra: localStorage)로 저장한다.
 */
export interface ProviderOrderState {
  order: readonly UsageProvider[]
  /** 기본 순서와 다른가(초기화 버튼 활성 조건) */
  customized: boolean
  /** id를 toIndex 위치로 옮기고 저장한다. 바뀌는 게 없으면 저장하지 않는다 */
  move(id: UsageProvider, toIndex: number): void
  /** 기본 순서로 되돌리고 저장값을 지운다 */
  reset(): void
  /** 포트에서 다시 읽어 반영한다(다른 탭이 바꾼 순서를 따라감). 저장은 하지 않고, 같은 순서면 상태를 바꾸지 않는다 */
  rehydrate(): void
}

export type ProviderOrderStoreApi = StoreApi<ProviderOrderState>

/** 저장된 순서를 읽어 정규화한 초기 상태로 스토어를 만든다. port가 null이면 저장하지 않는다(테스트·정적 렌더). */
export function createProviderOrderStore(port: ProviderOrderPort | null): ProviderOrderStoreApi {
  const initial = normalizeOrder(port?.load() ?? null, USAGE_PROVIDERS)
  return createStore<ProviderOrderState>()((set, get) => ({
    order: initial,
    customized: !isDefaultOrder(initial, USAGE_PROVIDERS),
    move: (id, toIndex) => {
      const current = get().order
      const next = moveProvider(current, id, toIndex)
      if (next === current) return
      set({ order: next, customized: !isDefaultOrder(next, USAGE_PROVIDERS) })
      port?.save(next)
    },
    reset: () => {
      port?.clear()
      set({ order: USAGE_PROVIDERS, customized: false })
    },
    rehydrate: () => {
      const next = normalizeOrder(port?.load() ?? null, USAGE_PROVIDERS)
      const current = get().order
      if (next.length === current.length && next.every((id, i) => id === current[i])) return
      set({ order: next, customized: !isDefaultOrder(next, USAGE_PROVIDERS) })
    },
  }))
}
