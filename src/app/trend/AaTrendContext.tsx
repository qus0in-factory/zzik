import { createContext, useContext, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { KeyValueStorage } from '@domain/usage/history/ports'
import type { AaTrendGateway } from '@domain/trend/aa-gateway'
import type { AaTrendResponse } from '@shared/trend-contract'

export interface AaTrendDeps {
  gateway: AaTrendGateway
  enabled: boolean
  /** 패널 접기/펼치기 상태 저장소(infra: localStorage). 없으면 저장하지 않는다. */
  storage?: KeyValueStorage
}

export class AaTrendLoadError extends Error {
  readonly reason: 'not_ready' | 'unauthorized' | 'api_error' | 'network_error'

  constructor(reason: AaTrendLoadError['reason'], message: string | null) {
    super(message ?? reason)
    this.reason = reason
  }
}

const defaultDeps: AaTrendDeps = {
  enabled: false,
  gateway: {
    async fetchAaTrend() {
      return { ok: false, reason: 'not_ready', message: 'not_configured' }
    },
  },
}

const AaTrendContext = createContext<AaTrendDeps>(defaultDeps)

export function AaTrendGatewayProvider({ deps, children }: { deps: AaTrendDeps; children: ReactNode }): ReactNode {
  return <AaTrendContext.Provider value={deps}>{children}</AaTrendContext.Provider>
}

export function useAaTrendDeps(): AaTrendDeps {
  return useContext(AaTrendContext)
}

export function useAaTrend(expanded: boolean): UseQueryResult<AaTrendResponse, AaTrendLoadError> {
  const { gateway, enabled } = useAaTrendDeps()
  return useQuery<AaTrendResponse, AaTrendLoadError>({
    queryKey: ['trend', 'aa'],
    enabled: enabled && expanded,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const result = await gateway.fetchAaTrend()
      if (!result.ok) throw new AaTrendLoadError(result.reason, result.message)
      return result.value
    },
  })
}
