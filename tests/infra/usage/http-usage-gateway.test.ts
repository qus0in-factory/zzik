import { describe, expect, it } from 'vitest'
import { HttpUsageGateway } from '@infra/usage/http-usage-gateway'
describe('Given a ky HTTP usage gateway', () => {
  it('When fetching Then it uses manual redirects and decodes 200', async () => {
    const requests: Request[] = []
    const gateway = new HttpUsageGateway(async (input) => { requests.push(input as Request); return Response.json({ snapshot: null }) }, 'https://zzik.qus0in.dev/api/usage')
    expect(await gateway.fetchUsage()).toEqual({ ok: true, usage: null, collection: null, rawText: null })
    expect(requests[0].url).toBe('https://zzik.qus0in.dev/api/usage'); expect(requests[0].redirect).toBe('manual')
  })
  it.each([401, 503, 502])('When HTTP status is %s Then it returns api_error with its code', async (status) => {
    const gateway = new HttpUsageGateway(async () => Response.json({ error: 'jwks_unavailable' }, { status }), 'https://test/api/usage')
    expect(await gateway.fetchUsage()).toEqual({ ok: false, reason: 'api_error', message: 'jwks_unavailable' })
  })
  it('When the response is opaqueredirect Then it reports session_expired', async () => {
    const response = new Response(); Object.defineProperty(response, 'type', { value: 'opaqueredirect' })
    const result = await new HttpUsageGateway(async () => response, 'https://test/api/usage').fetchUsage()
    expect(result).toEqual({ ok: false, reason: 'session_expired', message: null })
  })
  it('When fetch throws Then it reports network_error without leaking details', async () => {
    expect(await new HttpUsageGateway(async () => { throw new Error('private') }, 'https://test/api/usage').fetchUsage()).toEqual({ ok: false, reason: 'network_error', message: null })
  })
  it('When JSON is malformed Then it reports api_error', async () => {
    expect((await new HttpUsageGateway(async () => new Response('{'), 'https://test/api/usage').fetchUsage())).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
})
