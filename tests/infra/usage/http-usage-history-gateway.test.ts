import { describe, expect, it } from 'vitest'
import ky, { TimeoutError } from 'ky'
import { createHttpUsageHistoryGateway } from '@infra/usage/http-usage-history-gateway'
import claude from '../../fixtures/usage-history/claude.samples.json'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract'

function makeGateway(fakeFetch: typeof globalThis.fetch) {
  const client = ky.create({ fetch: fakeFetch, redirect: 'manual', retry: 0, throwHttpErrors: false, timeout: 10_000 })
  return createHttpUsageHistoryGateway(client, 'https://test/api/usage-history')
}
const capture = (response: () => Response | Promise<Response>) => {
  const requests: Request[] = []
  return { requests, fetch: (async (input: RequestInfo | URL) => (requests.push(input as Request), response())) as typeof globalThis.fetch }
}

describe('Given the ky history gateway (ADR 0.7 6.3·15절)', () => {
  it('When fetching samples Then the query string carries only the present fields, limit always, anchor only when true', async () => {
    const c = capture(() => Response.json(claude))
    const gateway = makeGateway(c.fetch)
    await gateway.fetchSamples('claude', { from: '2026-11-13T00:00:00.000Z', until: '2026-11-14T00:00:00.000Z', after: '2026-11-13T01:00:00.000Z_5', limit: 50, anchor: true })
    const url = new URL(c.requests[0].url)
    expect(url.pathname).toBe('/api/usage-history/claude')
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-11-13T00:00:00.000Z', until: '2026-11-14T00:00:00.000Z', after: '2026-11-13T01:00:00.000Z_5', limit: '50', anchor: '1' })
    expect(c.requests[0].redirect).toBe('manual')
    await gateway.fetchSamples('claude', { limit: 50, anchor: false })
    expect(Object.fromEntries(new URL(c.requests[1].url).searchParams)).toEqual({ limit: '50' })
  })
  it('When the response is 200 Then it is decoded (fields only)', async () => {
    const gateway = makeGateway(capture(() => Response.json(claude)).fetch)
    const result = await gateway.fetchSamples('claude', { limit: 50 })
    expect(result.ok && result.page.samples.length).toBeGreaterThan(0)
  })
  it('When the response has another scanVersion Then api_error scan_version_mismatch', async () => {
    const gateway = makeGateway(capture(() => Response.json({ ...claude, scanVersion: 99 })).fetch)
    expect(await gateway.fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'api_error', message: 'scan_version_mismatch' })
  })
  it('When the body is not valid Then invalid_response', async () => {
    const gateway = makeGateway(capture(() => new Response('<html>', { status: 200 })).fetch)
    expect(await gateway.fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
  it.each([
    [400, 'invalid_query'],
    [503, 'storage_unavailable'],
    [401, 'unauthorized'],
  ])('When HTTP %i carries {error} Then api_error with that code', async (status, code) => {
    const gateway = makeGateway(capture(() => Response.json({ error: code }, { status })).fetch)
    expect(await gateway.fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'api_error', message: code })
  })
  it('When the error body is not JSON Then the status code is kept', async () => {
    const gateway = makeGateway(capture(() => new Response('oops', { status: 502 })).fetch)
    expect(await gateway.fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'api_error', message: 'http_502' })
  })
  it('When the response is an opaque redirect Then session_expired', async () => {
    const redirect = new Response()
    Object.defineProperty(redirect, 'type', { value: 'opaqueredirect' })
    const gateway = makeGateway(capture(() => redirect).fetch)
    expect(await gateway.fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'session_expired', message: null })
  })
  it('When the request times out or the network fails Then request_timeout / network_error', async () => {
    expect(await makeGateway((async () => { throw new TimeoutError(new Request('https://test')) }) as typeof globalThis.fetch).fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'api_error', message: 'request_timeout' })
    expect(await makeGateway((async () => { throw new TypeError('network') }) as typeof globalThis.fetch).fetchSamples('claude', { limit: 50 })).toEqual({ ok: false, reason: 'network_error', message: null })
  })
  it('When fetching the summary Then GET /api/usage-history is decoded', async () => {
    const c = capture(() => Response.json({ summary: [{ provider: 'claude', okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' }] }))
    const result = await makeGateway(c.fetch).fetchSummary()
    expect(new URL(c.requests[0].url).pathname).toBe('/api/usage-history')
    expect(result.ok && result.summary[0].okCount).toBe(4)
  })
})


describe('Given the 30-day bucket gateway', () => {
  const bucket = {
    provider: 'claude', scanVersion: USAGE_HISTORY_SCAN_VERSION, bucketSec: 900,
    from: '2026-11-01T00:00:00.000Z', until: '2026-11-16T00:00:00.000Z',
    samples: [{ id: 'flat:1', runAt: '2026-11-01T00:15:00.000Z', status: 'ok', fetchedAt: '2026-11-01T00:15:00.000Z', intervalSec: 900, values: [{ id: 'five_hour', usedPercent: 12, resetsAt: null, cycleSeconds: null }] }],
    anchor: null, complete: true,
  }
  it('When fetching buckets Then GET /api/usage-history/:provider/buckets carries from/until/bucketSec=900', async () => {
    const c = capture(() => Response.json(bucket))
    const result = await makeGateway(c.fetch).fetchBuckets('claude', { from: bucket.from, until: bucket.until, bucketSec: 900 })
    const url = new URL(c.requests[0].url)
    expect(url.pathname).toBe('/api/usage-history/claude/buckets')
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: bucket.from, until: bucket.until, bucketSec: '900' })
    expect(result.ok && result.page.samples[0].id).toBe('flat:1')
  })
  it('When the bucket response has another version Then scan_version_mismatch', async () => {
    const gateway = makeGateway(capture(() => Response.json({ ...bucket, scanVersion: 99 })).fetch)
    expect(await gateway.fetchBuckets('claude', { from: bucket.from, until: bucket.until, bucketSec: 900 })).toEqual({ ok: false, reason: 'api_error', message: 'scan_version_mismatch' })
  })
})
