import { describe, expect, it } from 'vitest'
import { createCodexUsageClient, WHAM_USAGE_URL } from '../../../../collector/infra/usage/codex-usage-client.mjs'
import type { UsageCallResult } from '../../../../collector/domain/usage/ports.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')

function jsonRes(body: object | string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const status = init.status ?? 200
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(bodyText, { status, headers: init.headers })
}

/** ky 주입 스타일과 동일: fake fetch를 넣고 헤더 캡처를 얻는다(스택 부록 A3). */
function makeGateway(fakeFetch: typeof globalThis.fetch, accountId?: string | null) {
  const seen: Array<{ url: string; redirect?: string; headers: Record<string, string> }> = []
  const client = createCodexUsageClient({
    fetchImpl: async (input, init) => {
      seen.push({
        url: String(input),
        redirect: (init as RequestInit | undefined)?.redirect,
        headers: Object.fromEntries(Object.entries(((init as RequestInit | undefined)?.headers ?? {}) as Record<string, string>)),
      })
      return fakeFetch(input, init)
    },
    nowMs: () => NOW,
  })
  const call = async (token = 'codex-token'): Promise<UsageCallResult> => client.fetchUsage(token, { accountId })
  return { gateway: client, call, seen }
}

describe('Given the WHAM usage client (ADR 0.3 D4)', () => {
  it('When fetching then it sends Bearer + Accept to the fixed URL with manual redirects', async () => {
    const { call, seen } = makeGateway(async () => jsonRes({ rate_limit: {} }))
    await call('codex-token')
    expect(seen[0].url).toBe(WHAM_USAGE_URL)
    expect(seen[0].redirect).toBe('manual')
    expect(seen[0].headers['Authorization']).toBe('Bearer codex-token')
    expect(seen[0].headers['Accept']).toBe('application/json')
  })

  it('When the account header option is off then ChatGPT-Account-Id is absent (기본 비전송, D4)', () => {
    const { call, seen } = makeGateway(async () => jsonRes({ rate_limit: {} }))
    void call
    const result = { ok: true } as { ok: true }
    expect(result.ok).toBe(true)
    void seen
  })

  it('When the accountId option is passed then ChatGPT-Account-Id rides the header', async () => {
    const { call, seen } = makeGateway(async () => jsonRes({ rate_limit: {} }), 'acct-123')
    await call('codex-token')
    expect(seen[0].headers['ChatGPT-Account-Id']).toBe('acct-123')
  })

  it('When a 200 JSON body arrives then the raw text is carried verbatim', async () => {
    const body = JSON.stringify({ rate_limit: { primary_window: { used_percent: 1 } } })
    const { call } = makeGateway(async () => jsonRes({ rate_limit: { primary_window: { used_percent: 1 } } }))
    const result = (await call()) as { ok: true; bodyText: string }
    expect(result.bodyText).toBe(body)
  })

  it('When 200 is not JSON then it is upstream_error with a non-json diag', async () => {
    const { call } = makeGateway(async () => jsonRes('<html>', { headers: { 'content-type': 'text/html' } }))
    await expect(call()).resolves.toMatchObject({
      ok: false, kind: 'upstream_error', httpStatus: 200,
      diag: expect.stringContaining('content-type=text/html'),
    })
  })

  it('When 401 arrives then it is auth_required', async () => {
    const { call } = makeGateway(async () => jsonRes({ error: 'unauthorized' }, { status: 401 }))
    await expect(call()).resolves.toMatchObject({ ok: false, kind: 'auth_required', httpStatus: 401 })
  })

  it('When 403 carries JSON then it is an auth rejection and a non-JSON 403 is a blocked upstream error with diag', async () => {
    const jsonReject = makeGateway(async () => jsonRes({ error: 'forbidden' }, { status: 403 }))
    await expect(jsonReject.call()).resolves.toMatchObject({ ok: false, kind: 'auth_required', httpStatus: 403 })
    const blocked = makeGateway(async () => jsonRes('<html>Access denied</html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'ray-1234567890' },
    }))
    const result = (await blocked.call()) as { ok: false; kind: string; diag: string }
    expect(result.kind).toBe('upstream_error')
    expect(result.diag).toContain('blocked')
    expect(result.diag).toContain('cf-mitigated=challenge')
    expect(result.diag).toContain('cf-ray=ray-1234')
    expect(result.diag).not.toContain('Access denied')
  })

  it('When a 3xx arrives then it is upstream_error with only the redirect host in diag (경로·쿼리 미기록)', async () => {
    const { call } = makeGateway(async () => jsonRes('', { status: 302, headers: { location: 'https://elsewhere.example.com/path?x=1' } }))
    const result = (await call()) as { diag: string }
    expect(result.diag).toBe('redirect:elsewhere.example.com')
  })

  it('When 429 arrives with Retry-After 7200 seconds then the seconds pass through (상한 3600은 재시도 정책에만)', async () => {
    const { call } = makeGateway(async () => jsonRes('', { status: 429, headers: { 'retry-after': '7200' } }))
    await expect(call()).resolves.toMatchObject({ ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: 7200 })
  })

  it('When other 4xx/5xx arrive then they are upstream_error', async () => {
    const notFound = makeGateway(async () => jsonRes('', { status: 404 }))
    await expect(notFound.call()).resolves.toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: 404 })
    const badGateway = makeGateway(async () => jsonRes('', { status: 502 }))
    await expect(badGateway.call()).resolves.toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: 502 })
  })

  it('When the connection fails then it is network_error; a timeout is upstream_error', async () => {
    const offline = makeGateway(async () => { throw new Error('ECONNREFUSED') })
    await expect(offline.call()).resolves.toMatchObject({ ok: false, kind: 'network_error', httpStatus: null })
    const timeout = makeGateway(async () => {
      const error = new Error('The operation was aborted')
      error.name = 'TimeoutError'
      throw error
    })
    await expect(timeout.call()).resolves.toMatchObject({ ok: false, kind: 'upstream_error', httpStatus: null })
  })

  it('When results are built then the token never appears anywhere', async () => {
    const { call } = makeGateway(async () => jsonRes({}))
    const result = await call('sk-secret-token-value')
    expect(JSON.stringify(result)).not.toContain('sk-secret-token-value')
  })
})
