import { describe, expect, it } from 'vitest'
import { createGrokUsageClient, GROK_BILLING_URL, GROK_CLIENT_HEADERS } from '../../../../collector/infra/usage/grok-usage-client.mjs'
import { createOpencodeUsageClient, OPENCODE_USAGE_URL } from '../../../../collector/infra/usage/opencode-usage-client.mjs'
import { createOllamaUsageClient, isAllowedOllamaHost } from '../../../../collector/infra/usage/ollama-usage-client.mjs'
import { readOllamaLocalCredentials } from '../../../../collector/infra/usage/ollama-local-credentials.mjs'

interface Seen {
  url: string
  init: RequestInit & { headers: Record<string, string> }
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string, init: Seen['init']) => {
    seen.push({ url, init })
    return respond()
  }) as unknown as typeof fetch
  return { fetchImpl, seen }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const clients = [
  ['grok', (fetchImpl: typeof fetch) => createGrokUsageClient({ fetchImpl, nowMs: () => 0 })],
  ['opencode', (fetchImpl: typeof fetch) => createOpencodeUsageClient({ fetchImpl, nowMs: () => 0 })],
  ['ollama', (fetchImpl: typeof fetch) => createOllamaUsageClient({ fetchImpl, nowMs: () => 0 })],
] as const

describe.each(clients)('Given the %s usage client classification (ADR 0.3 D4)', (_name, make) => {
  const call = (respond: () => Response | Promise<Response>) => make(fakeFetch(respond).fetchImpl).fetchUsage('secret')

  it('When 200 JSON object Then ok with the body text', async () => {
    expect(await call(() => json({ a: 1 }))).toEqual({ ok: true, bodyText: '{"a":1}', httpStatus: 200, retryAfterSec: null })
  })
  it('When 200 but not an object Then upstream_error', async () => {
    expect(await call(() => json([1]))).toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: 200 })
    expect(await call(() => new Response('<html>', { status: 200 }))).toMatchObject({ ok: false, kind: 'upstream_error' })
  })
  it('When 401 or JSON 403 Then auth_required; HTML 403 Then upstream_error', async () => {
    expect(await call(() => json({}, 401))).toMatchObject({ kind: 'auth_required', httpStatus: 401 })
    expect(await call(() => json({ e: 1 }, 403))).toMatchObject({ kind: 'auth_required' })
    expect(await call(() => new Response('<html>', { status: 403 }))).toMatchObject({ kind: 'upstream_error', httpStatus: 403 })
  })
  it('When 429 Then rate_limited with Retry-After seconds', async () => {
    expect(await call(() => json({}, 429, { 'retry-after': '600' }))).toMatchObject({ kind: 'rate_limited', retryAfterSec: 600 })
  })
  it('When 3xx Then upstream_error redirect without following', async () => {
    expect(await call(() => new Response(null, { status: 302 }))).toMatchObject({ kind: 'upstream_error', diag: 'redirect' })
  })
  it('When the request times out or fails Then upstream_error(timeout) / network_error', async () => {
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' })
    expect(await call(() => Promise.reject(timeout))).toMatchObject({ kind: 'upstream_error', diag: 'timeout' })
    expect(await call(() => Promise.reject(new Error('ECONNREFUSED')))).toMatchObject({ kind: 'network_error', httpStatus: null })
  })
  it('When failing Then no response body leaks into the result', async () => {
    const result = await call(() => json({ secret: 'LEAK' }, 500))
    expect(JSON.stringify(result)).not.toContain('LEAK')
  })
})

describe('Given the Grok request', () => {
  it('When fetching Then GET with bearer, Accept and the two approved client headers, no User-Agent', async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({}))
    await createGrokUsageClient({ fetchImpl }).fetchUsage('tok')
    expect(seen[0].url).toBe(GROK_BILLING_URL)
    expect(GROK_BILLING_URL).toBe('https://cli-chat-proxy.grok.com/v1/billing?format=credits')
    expect(seen[0].init.method).toBe('GET')
    expect(seen[0].init.redirect).toBe('manual')
    expect(seen[0].init.headers).toEqual({
      Authorization: 'Bearer tok',
      Accept: 'application/json',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-version': '1.0.0',
    })
    expect(GROK_CLIENT_HEADERS).toEqual({ 'X-XAI-Token-Auth': 'xai-grok-cli', 'x-grok-client-version': '1.0.0' })
    expect(Object.isFrozen(GROK_CLIENT_HEADERS)).toBe(true)
  })
})

describe('Given the OpenCode request', () => {
  it('When fetching Then GET with only Authorization and Accept', async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({}))
    await createOpencodeUsageClient({ fetchImpl }).fetchUsage('tok')
    expect(seen[0].url).toBe(OPENCODE_USAGE_URL)
    expect(seen[0].init.method).toBe('GET')
    expect(seen[0].init.redirect).toBe('manual')
    expect(seen[0].init.headers).toEqual({ Authorization: 'Bearer tok', Accept: 'application/json' })
  })
})

describe('Given the Ollama request', () => {
  it('When fetching Then GET /api/balance on the local daemon without Authorization', async () => {
    const { fetchImpl, seen } = fakeFetch(() => json({}))
    await createOllamaUsageClient({ fetchImpl }).fetchUsage()
    expect(seen[0].url).toBe('http://127.0.0.1:11434/api/balance')
    expect(seen[0].init.headers).toEqual({ Accept: 'application/json' })
  })
  it.each(['http://127.0.0.1:11434', 'http://localhost:8080', 'http://[::1]:11434'])('When host is %s Then allowed', (host) => {
    expect(isAllowedOllamaHost(host)).toBe(true)
    expect(() => createOllamaUsageClient({ fetchImpl: fetch, host })).not.toThrow()
  })
  it.each(['http://example.com:11434', 'https://127.0.0.1:11434', 'http://10.0.0.5:11434', 'http://127.0.0.1', 'http://127.0.0.1:11434/x', 'http://localhost.evil.com:80'])(
    'When host is %s Then rejected with TypeError',
    (host) => {
      expect(isAllowedOllamaHost(host)).toBe(false)
      expect(() => createOllamaUsageClient({ fetchImpl: fetch, host })).toThrow(TypeError)
    },
  )
  it('When the daemon answers 404 Then upstream_error; 401 Then auth_required', async () => {
    expect(await createOllamaUsageClient({ fetchImpl: fakeFetch(() => json({}, 404)).fetchImpl }).fetchUsage()).toMatchObject({ kind: 'upstream_error', httpStatus: 404 })
    expect(await createOllamaUsageClient({ fetchImpl: fakeFetch(() => json({}, 401)).fetchImpl }).fetchUsage()).toMatchObject({ kind: 'auth_required' })
  })
  it('When reading local credentials Then always one tokenless read', async () => {
    expect(await readOllamaLocalCredentials()).toEqual({ source: 'ollama-local', token: '', expiresAt: null, accountId: null })
  })
})
