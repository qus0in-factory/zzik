import ky from 'ky'
import { decodeUsageSnapshot } from '@domain/usage/snapshot'
import type { SnapshotUsageGateway, SnapshotGatewayResult } from '@domain/usage/snapshot'
export class HttpUsageGateway implements SnapshotUsageGateway {
  private readonly client: typeof ky
  constructor(fetcher: typeof globalThis.fetch = globalThis.fetch, private readonly endpoint = '/api/usage') {
    this.client = ky.create({ fetch: fetcher, redirect: 'manual', retry: 0, throwHttpErrors: false })
  }
  async fetchUsage(): Promise<SnapshotGatewayResult> {
    let response: Response
    try { response = await this.client.get(this.endpoint) }
    catch { return { ok: false, reason: 'network_error', message: null } }
    if (response.type === 'opaqueredirect') return { ok: false, reason: 'session_expired', message: null }
    if (response.status !== 200) {
      let message = `http_${response.status}`
      try {
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') message = body.error
      } catch { /* A non-JSON error still has an HTTP status. */ }
      return { ok: false, reason: 'api_error', message }
    }
    try { return decodeUsageSnapshot(await response.json()) }
    catch { return { ok: false, reason: 'api_error', message: 'invalid_response' } }
  }
}
