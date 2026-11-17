import type ky from 'ky'
import { TimeoutError } from 'ky'
import type { TrendSection, TrendSectionPayload } from '@shared/trend-contract'
import type { TrendGateway, TrendGatewayResult } from '@domain/trend/gateway'

/** `/pub/trend/:section` 공개 게이트웨이. 인증 헤더를 보내지 않는다. */
export function createHttpTrendGateway(client: typeof ky, basePath = '/pub/trend'): TrendGateway {
  return {
    async fetchSection(section: TrendSection): Promise<TrendGatewayResult> {
      let response: Response
      try {
        response = await client.get(`${basePath}/${section}`)
      } catch (error) {
        if (error instanceof TimeoutError) return { ok: false, reason: 'network_error', message: 'request_timeout' }
        return { ok: false, reason: 'network_error', message: null }
      }
      if (response.status === 200) {
        try {
          const value = await response.json() as TrendSectionPayload
          if (value === null || typeof value !== 'object' || value.section !== section || !Array.isArray(value.items)) {
            return { ok: false, reason: 'api_error', message: 'invalid_response' }
          }
          return { ok: true, value }
        } catch {
          return { ok: false, reason: 'api_error', message: 'invalid_response' }
        }
      }
      let message = `http_${response.status}`
      try {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') message = body.error
      } catch {
        /* no JSON body */
      }
      if (response.status === 503) return { ok: false, reason: 'not_ready', message }
      return { ok: false, reason: 'api_error', message }
    },
  }
}
