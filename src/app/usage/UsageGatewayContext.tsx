import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { UsageClock, UsageGateway, UsageScheduler, UsageVisibility } from '@domain/usage/gateway'

/** 조립 루트(main.tsx)가 만든 게이트웨이·시계·타이머·가시성 의존을 훅에 전달한다(ADR 0.2 D11). */
export interface UsageDeps {
  gateway: UsageGateway
  clock: UsageClock
  scheduler: UsageScheduler
  visibility: UsageVisibility
}

const UsageGatewayContext = createContext<UsageDeps | null>(null)

export function UsageGatewayProvider({ deps, children }: { deps: UsageDeps; children: ReactNode }): ReactNode {
  return <UsageGatewayContext.Provider value={deps}>{children}</UsageGatewayContext.Provider>
}

export function useUsageDeps(): UsageDeps {
  const deps = useContext(UsageGatewayContext)
  if (!deps) {
    throw new Error('UsageGatewayProvider로 사용량 의존을 주입해야 한다(조립 루트 담당).')
  }
  return deps
}
