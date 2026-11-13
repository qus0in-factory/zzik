import type ky from 'ky'
import { TimeoutError } from 'ky'
import type { UsageGateway, UsageGatewayResult } from '@domain/usage/gateway'
import type { UsageProvider } from '@domain/usage/providers'
import { decodeUsageSnapshot } from '@domain/usage/snapshot'

/**
 * `/api/usage/:provider` 게이트웨이(스택 부록 A3, ADR 0.3 D7·D8). ky 인스턴스는
 * 조립 루트(main.tsx)가 만들어 주입한다:
 *   ky.create({ retry: 0, throwHttpErrors: false, redirect: 'manual', timeout: 10_000 })
 * 재시도는 ky에 두지 않는다(재시도 정책은 Query 한 곳). 경로는 제공자별 1:1이다.
 */
export function createHttpUsageGateway(client: typeof ky, basePath = '/api/usage'): UsageGateway {
  return {
    async fetchUsage(provider: UsageProvider): Promise<UsageGatewayResult> {
      let response: Response
      try {
        response = await client.get(`${basePath}/${provider}`)
      } catch (error) {
        if (error instanceof TimeoutError) return { ok: false, reason: 'api_error', message: 'request_timeout' }
        return { ok: false, reason: 'network_error', message: null }
      }
      if (response.type === 'opaqueredirect') return { ok: false, reason: 'session_expired', message: null }
      if (response.status !== 200) {
        let message = `http_${response.status}`
        try {
          const body: unknown = await response.json()
          if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
            message = body.error
          }
        } catch {
          /* JSON이 아닌 오류 본문이라도 상태 코드는 남는다 */
        }
        return { ok: false, reason: 'api_error', message }
      }
      try {
        return decodeUsageSnapshot(await response.json(), provider)
      } catch {
        return { ok: false, reason: 'api_error', message: 'invalid_response' }
      }
    },
  }
}
