import ky from 'ky'
import { TREND_AA_API_PATH } from '@shared/trend-contract'
import type { AaTrendResponse } from '@shared/trend-contract'
import type { AaTrendGateway, AaTrendResult } from '@domain/trend/aa-gateway'

function isAaTrendResponse(value: unknown): value is AaTrendResponse {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Partial<AaTrendResponse>
  return (
    typeof body.day === 'string' &&
    typeof body.indexVersion === 'string' &&
    typeof body.attribution === 'string' &&
    Array.isArray(body.intelligenceTop) &&
    Array.isArray(body.priceLowest) &&
    Array.isArray(body.priceHighest) &&
    Array.isArray(body.speedHighest) &&
    Array.isArray(body.latencyLowest)
  )
}

export function createHttpAaTrendGateway(
  http = ky.create({ retry: 0, throwHttpErrors: false, redirect: 'manual', timeout: 10_000 }),
  path = TREND_AA_API_PATH,
): AaTrendGateway {
  return {
    async fetchAaTrend(): Promise<AaTrendResult> {
      try {
        const res = await http.get(path)
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: 'unauthorized', message: `http_${res.status}` }
        }
        if (res.status === 503) {
          return { ok: false, reason: 'not_ready', message: 'not_ready' }
        }
        if (!res.ok) {
          return { ok: false, reason: 'api_error', message: `http_${res.status}` }
        }
        const json: unknown = await res.json()
        if (!isAaTrendResponse(json)) {
          return { ok: false, reason: 'api_error', message: 'invalid_response' }
        }
        return { ok: true, value: json }
      } catch (error) {
        return { ok: false, reason: 'network_error', message: error instanceof Error ? error.message : null }
      }
    },
  }
}
