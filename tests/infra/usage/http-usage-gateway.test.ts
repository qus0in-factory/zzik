import { describe, expect, it } from 'vitest'
import ky from 'ky'
import { createHttpUsageGateway } from '@infra/usage/http-usage-gateway'

/** A3: ky 인스턴스는 조립 루트가 ky.create({ fetch: 가짜, … })로 만들어 주입한다. */
function makeGateway(fakeFetch: typeof globalThis.fetch, basePath = '/api/usage'): ReturnType<typeof createHttpUsageGateway> {
  const client = ky.create({ fetch: fakeFetch, redirect: 'manual', retry: 0, throwHttpErrors: false, timeout: 10_000 })
  return createHttpUsageGateway(client, basePath)
}

describe('Given a ky HTTP usage gateway (ADR 0.3 D7)', () => {
  it('When fetching claude with manual redirects then it decodes a 200 envelope', async () => {
    const requests: Request[] = []
    const gateway = makeGateway(async (input: RequestInfo | URL) => {
      requests.push(input as Request)
      return Response.json({ snapshot: null })
    }, 'https://zzik.qus0in.dev/api/usage')
    expect(await gateway.fetchUsage('claude')).toEqual({ ok: true, usage: null, collection: null, rawText: null })
    expect(requests[0].url).toBe('https://zzik.qus0in.dev/api/usage/claude')
    expect(requests[0].redirect).toBe('manual')
  })

  it('When fetching codex then the path is provider specific', async () => {
    const requests: Request[] = []
    const gateway = makeGateway(async (input: RequestInfo | URL) => {
      requests.push(input as Request)
      return Response.json({ snapshot: null })
    }, 'https://test/api/usage')
    await gateway.fetchUsage('codex')
    expect(requests[0].url).toBe('https://test/api/usage/codex')
  })

  it('When the envelope belongs to another provider then it is rejected', async () => {
    const envelope = {
      schema: 1,
      provider: 'claude',
      status: 'ok',
      called: true,
      runAt: '2026-11-11T12:00:00.000Z',
      fetchedAt: null,
      httpStatus: 200,
      retryAt: null,
      tokenExpiresAt: null,
      kvTokenExpiresAt: null,
      intervalSec: 300,
      collectorVersion: '0.3.0',
      rawText: null,
      rawOmitted: null,
    }
    const gateway = makeGateway(async () => Response.json({ snapshot: envelope }), 'https://test/api/usage')
    await expect(gateway.fetchUsage('codex')).resolves.toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
    await expect(gateway.fetchUsage('claude')).resolves.toMatchObject({ ok: true })
  })

  it.each([401, 503, 502])('When HTTP status is %s then it returns api_error with its code', async (status) => {
    const gateway = makeGateway(async () => Response.json({ error: 'jwks_unavailable' }, { status }), 'https://test/api/usage')
    await expect(gateway.fetchUsage('claude')).resolves.toEqual({ ok: false, reason: 'api_error', message: 'jwks_unavailable' })
  })

  it('When the response is opaqueredirect then it reports session_expired', async () => {
    const response = new Response()
    Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
    const gateway = makeGateway(async () => response, 'https://test/api/usage')
    await expect(gateway.fetchUsage('codex')).resolves.toEqual({ ok: false, reason: 'session_expired', message: null })
  })

  it('When fetch throws then it reports network_error without leaking details', async () => {
    const gateway = makeGateway(async () => {
      throw new Error('private')
    }, 'https://test/api/usage')
    await expect(gateway.fetchUsage('claude')).resolves.toEqual({ ok: false, reason: 'network_error', message: null })
  })

  it('When JSON is malformed then it reports api_error', async () => {
    const gateway = makeGateway(async () => new Response('{'), 'https://test/api/usage')
    await expect(gateway.fetchUsage('claude')).resolves.toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
})

describe('Given Antigravity HTTP routing', () => {
  it('When fetching Then targets its own API path', async () => {
    let url=''
    const gateway=makeGateway(async input=>{url=(input as Request).url;return Response.json({snapshot:null})},'https://test/api/usage')
    expect(await gateway.fetchUsage('antigravity')).toMatchObject({ok:true})
    expect(url).toBe('https://test/api/usage/antigravity')
  })
})
