import { describe, expect, it, vi } from 'vitest'
import { createUsageClient, USAGE_URL } from '../../../../collector/infra/usage/usage-client.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')

function okResponse(body = '{"five_hour":{}}'): Response {
  return new Response(body, { status: 200, headers: {} })
}

function statusResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers })
}

describe('Given the usage HTTP client', () => {
  it('When fetching then it sends the OAuth headers to the usage endpoint', async () => {
    const fetchImpl = vi.fn(async () => okResponse())
    const client = createUsageClient({ fetchImpl, nowMs: () => NOW })
    await client.fetchUsage('the-access-token')
    expect(fetchImpl).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        method: 'GET',
        headers: {
          Authorization: 'Bearer the-access-token',
          'anthropic-beta': 'oauth-2025-04-20',
          Accept: 'application/json',
        },
        signal: expect.anything(),
      }),
    )
  })

  it('When the response is 200 then the body text is carried verbatim', async () => {
    const body = '{"five_hour":{"utilization":37}}'
    const client = createUsageClient({ fetchImpl: async () => okResponse(body), nowMs: () => NOW })
    const result = await client.fetchUsage('t')
    expect(result.ok).toBe(true)
    expect(result.httpStatus).toBe(200)
    expect(result.bodyText).toBe(body)
  })

  it('When the endpoint rate limits with Retry-After then the kind and seconds come back', async () => {
    const client = createUsageClient({ fetchImpl: async () => statusResponse(429, { 'retry-after': '7200' }), nowMs: () => NOW })
    const result = await client.fetchUsage('t')
    expect(result).toEqual({ ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: 7200 })
  })

  it('When the endpoint needs auth or errors upstream then the kinds match the table', async () => {
    const client = createUsageClient({
      fetchImpl: async (url: string) => (url === USAGE_URL ? statusResponse(401) : statusResponse(503)),
      nowMs: () => NOW,
    })

    const authResult = createUsageClient({ fetchImpl: async () => statusResponse(401), nowMs: () => NOW }).fetchUsage('t')
    const forbidden = createUsageClient({ fetchImpl: async () => statusResponse(403), nowMs: () => NOW }).fetchUsage('t')
    const upstream = createUsageClient({ fetchImpl: async () => statusResponse(503), nowMs: () => NOW }).fetchUsage('t')
    const notFound = createUsageClient({ fetchImpl: async () => statusResponse(404), nowMs: () => NOW }).fetchUsage('t')

    expect((await authResult).kind).toBe('auth_required')
    expect((await forbidden).kind).toBe('auth_required')
    expect((await upstream).kind).toBe('upstream_error')
    expect((await notFound).kind).toBe('upstream_error')
    expect((await notFound).httpStatus).toBe(404)
  })

  it('When the request throws or times out then it is a network error without a status', async () => {
    const client = createUsageClient({ fetchImpl: async () => { throw new Error('offline') }, nowMs: () => NOW })
    expect(await client.fetchUsage('t')).toEqual({ ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null })
  })

  it('When building then the timeout option is 10 seconds', () => {
    const fetchImpl = vi.fn(async () => okResponse())
    createUsageClient({ fetchImpl, nowMs: () => NOW }).fetchUsage('t')
    const init = fetchImpl.mock.calls[0][1]
    expect(init.timeoutMs).toBe(10_000)
  })
})
