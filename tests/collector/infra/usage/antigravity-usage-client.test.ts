import { describe, it, expect } from 'vitest'
import { createAntigravityUsageClient } from '../../../../collector/infra/usage/antigravity-usage-client.mjs'
describe('Given the Antigravity summary client', () => {
  it.each(['cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com'])('When host is %s Then sends a fixed POST with only required headers', async host => {
    let seen: RequestInit | undefined
    let url = ''
    const client = createAntigravityUsageClient({ host, project: 'fake-project', fetchImpl: async (input, init) => { url = String(input); seen = init; return new Response('{"groups":[]}') } })
    expect(await client.fetchUsage('fake-token')).toMatchObject({ ok: true, bodyText: '{"groups":[]}' })
    expect(url).toBe('https://' + host + '/v1internal:retrieveUserQuotaSummary')
    expect(seen).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"project":"fake-project"}', headers: { Authorization: 'Bearer fake-token', Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Antigravity/1.0' } })
    expect(Object.keys(seen?.headers ?? {})).toHaveLength(4)
    expect(seen?.signal).toBeInstanceOf(AbortSignal)
  })
  it('When host is not allowlisted Then rejects configuration before calling fetch', () => {
    expect(() => createAntigravityUsageClient({ host: 'evil.example', fetchImpl: async () => { throw Error('must not call') } })).toThrow()
  })
  it.each([[401, 'auth_required'], [403, 'auth_required'], [429, 'rate_limited'], [500, 'upstream_error'], [404, 'upstream_error']])('When status is %s Then classifies without leaking body or tokens', async (status, kind) => {
    const client = createAntigravityUsageClient({ fetchImpl: async () => new Response('{"error":{"status":"PERMISSION_DENIED","message":"SECRET"}}', { status: Number(status), headers: { 'retry-after': '120' } }) })
    const result = await client.fetchUsage('fake-secret')
    expect(result).toMatchObject({ ok: false, kind, httpStatus: status, diag: 'PERMISSION_DENIED' })
    if (status === 429) expect(result.retryAfterSec).toBe(300)
    expect(JSON.stringify(result)).not.toMatch(/SECRET|fake-secret/)
  })
  it.each([200,403,302])('When %s carries HTML Then reports upstream error and no body', async status => {
    const client = createAntigravityUsageClient({ fetchImpl: async () => new Response('<html>SECRET</html>', { status, headers: { location: 'https://example.com/private?secret=1' } }) })
    const result = await client.fetchUsage('fake')
    expect(result).toMatchObject({ ok: false, kind: 'upstream_error' })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it.each(['TimeoutError','AbortError','Error'])('When fetch throws %s Then uses the shared failure categories', async name => {
    const client = createAntigravityUsageClient({ fetchImpl: async () => { const error = new Error('secret'); error.name = name; throw error } })
    expect(await client.fetchUsage('fake')).toMatchObject({ ok: false, kind: name === 'Error' ? 'network_error' : 'upstream_error' })
  })
})
