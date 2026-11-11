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
    await expect(client.fetchUsage('t')).resolves.toMatchObject({
      ok: true,
      httpStatus: 200,
      bodyText: body,
    })
  })

  it('When the endpoint rate limits with Retry-After then the kind and seconds come back (7200은 잘리지 않는다)', async () => {
    const client = createUsageClient({ fetchImpl: async () => statusResponse(429, { 'retry-after': '7200' }), nowMs: () => NOW })
    await expect(client.fetchUsage('t')).resolves.toEqual({ ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: 7200 })
  })

  it('When the endpoint needs auth then the kind is auth_required', async () => {
    const client = createUsageClient({ fetchImpl: async () => statusResponse(401), nowMs: () => NOW })
    await expect(client.fetchUsage('t')).resolves.toMatchObject({ ok: false, kind: 'auth_required', httpStatus: 401 })
  })

  it('When the response is 403, 5xx or another 4xx then the kinds map to upstream/auth as designed', async () => {
    const forbidden = await createUsageClient({ fetchImpl: async () => statusResponse(403), nowMs: () => NOW }).fetchUsage('t')
    expect(forbidden).toMatchObject({ ok: false, kind: 'auth_required', httpStatus: 403 })
    const upstream = await createUsageClient({ fetchImpl: async () => statusResponse(503), nowMs: () => NOW }).fetchUsage('t')
    expect(upstream).toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: 503 })
    const notFound = await createUsageClient({ fetchImpl: async () => statusResponse(404), nowMs: () => NOW }).fetchUsage('t')
    expect(notFound).toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: 404 })
  })

  it('When the request throws or times out then it is a network error without a status', async () => {
    const client = createUsageClient({
      fetchImpl: async () => {
        throw new Error('offline')
      },
      nowMs: () => NOW,
    })
    await expect(client.fetchUsage('t')).resolves.toEqual({ ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null })
  })
})
