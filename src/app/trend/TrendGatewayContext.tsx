import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { TrendGateway } from '@domain/trend/gateway'

export interface TrendDeps {
  gateway: TrendGateway
  enabled: boolean
}

const disabledGateway: TrendGateway = {
  async fetchSection() {
    return { ok: false, reason: 'not_ready', message: 'not_ready' }
  },
}

const disabled: TrendDeps = { gateway: disabledGateway, enabled: false }
const TrendDepsContext = createContext<TrendDeps>(disabled)

export function TrendGatewayProvider({ deps, children }: { deps: TrendDeps; children: ReactNode }): ReactNode {
  return <TrendDepsContext.Provider value={deps}>{children}</TrendDepsContext.Provider>
}

export function useTrendDeps(): TrendDeps {
  return useContext(TrendDepsContext)
}
