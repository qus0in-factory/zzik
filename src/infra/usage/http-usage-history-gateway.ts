import type ky from 'ky'
import { TimeoutError } from 'ky'
import { USAGE_HISTORY_PATH } from '../../../shared/usage-history-contract'
import type { UsageHistoryQuery } from '../../../shared/usage-history-contract'
import { decodeHistoryPage, decodeHistorySummary } from '@domain/usage/history/decode-history'
import type { UsageHistoryGateway, UsageHistoryGatewayFailure } from '@domain/usage/history/ports'
import type { UsageProvider } from '@domain/usage/providers'

/**
 * `/api/usage-history` 게이트웨이(ADR 0.7 4·6.3절). ky 인스턴스는 조립 루트가 주입한다(사용량 게이트웨이와 같은 설정:
 * `redirect: 'manual'`, `retry: 0`, `throwHttpErrors: false`, 10초). 재시도는 Query 한 곳에서 한다.
 * 응답은 domain 디코더가 계약 필드만 골라 돌려준다.
 */
export function createHttpUsageHistoryGateway(client: typeof ky, basePath: string = USAGE_HISTORY_PATH): UsageHistoryGateway {
  async function request(url: string): Promise<{ ok: true; body: unknown } | UsageHistoryGatewayFailure> {
    let response: Response
    try {
      response = await client.get(url)
    } catch (error) {
      if (error instanceof TimeoutError) return { ok: false, reason: 'api_error', message: 'request_timeout' }
      return { ok: false, reason: 'network_error', message: null }
    }
    if (response.type === 'opaqueredirect') return { ok: false, reason: 'session_expired', message: null }
    if (response.status !== 200) {
      let message = `http_${response.status}`
      try {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') message = body.error
      } catch {
        /* JSON이 아닌 오류 본문이라도 상태 코드는 남는다 */
      }
      return { ok: false, reason: 'api_error', message }
    }
    try {
      return { ok: true, body: await response.json() }
    } catch {
      return { ok: false, reason: 'api_error', message: 'invalid_response' }
    }
  }

  return {
    async fetchSummary() {
      const result = await request(basePath)
      if (!result.ok) return result
      return decodeHistorySummary(result.body)
    },
    async fetchSamples(provider: UsageProvider, query: UsageHistoryQuery) {
      const params = new URLSearchParams()
      if (query.from !== undefined) params.set('from', query.from)
      if (query.until !== undefined) params.set('until', query.until)
      if (query.after !== undefined) params.set('after', query.after)
      params.set('limit', String(query.limit))
      if (query.anchor === true) params.set('anchor', '1')
      const result = await request(`${basePath}/${provider}?${params.toString()}`)
      if (!result.ok) return result
      return decodeHistoryPage(result.body, provider)
    },
  }
}
