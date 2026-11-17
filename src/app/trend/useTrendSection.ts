import { useQuery } from '@tanstack/react-query'
import type { TrendSection } from '@shared/trend-contract'
import type { TrendGatewayFailureReason } from '@domain/trend/gateway'
import { useTrendDeps } from './TrendGatewayContext'

export const TREND_SECTION_STALE_MS = 5 * 60_000
export const TREND_SECTION_REFETCH_MS = 15 * 60_000

export class TrendLoadError extends Error {
  readonly reason: TrendGatewayFailureReason
  readonly code: string | null
  constructor(reason: TrendGatewayFailureReason, code: string | null) {
    super(code ?? reason)
    this.name = 'TrendLoadError'
    this.reason = reason
    this.code = code
  }
}

export function trendSectionKey(section: TrendSection) {
  return ['trend', section] as const
}

export function useTrendSection(section: TrendSection) {
  const deps = useTrendDeps()
  return useQuery({
    queryKey: trendSectionKey(section),
    enabled: deps.enabled,
    staleTime: TREND_SECTION_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: TREND_SECTION_REFETCH_MS,
    queryFn: async () => {
      const result = await deps.gateway.fetchSection(section)
      if (!result.ok) throw new TrendLoadError(result.reason, result.message)
      return result.value
    },
  })
}
