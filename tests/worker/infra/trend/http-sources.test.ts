import { describe, expect, it } from 'vitest'
import payload from '../../../fixtures/trend/new-models.payload.json'
import { createModelsDevSource, createOpenRouterSource } from '../../../../worker/infra/trend/http-sources'

const source = (fetchImpl: typeof fetch) => createModelsDevSource({ fetchImpl, timeoutMs: 10 })

describe('Given the models.dev HTTP source adapter', () => {
  it('When a 200 JSON arrives Then decodes models and returns the ETag and byte count', async () => {
    const models = { anthropic: { id: 'anthropic', models: { x: { id: 'x', name: 'X', release_date: '2026-11-16', cost: { input: 0, output: 0 } } } } }
    const result = await source(async () => new Response(JSON.stringify(models), { status: 200, headers: { etag: '"v1"' } })) .fetch(null)
    expect(result).toMatchObject({ ok: true, notModified: false, etag: '"v1"' })
    if (result.ok) {
      expect(result.models).toHaveLength(1)
      expect(result.models?.[0]).toMatchObject({ canonicalId: 'x', free: true })
      expect(result.bytes).toBeGreaterThan(0)
    }
  })

  it('When If-None-Match gets 304 Then reports notModified without parsing a body', async () => {
    let header: string | null = null
    const result = await source(async (_url, init) => {
      header = new Headers(init?.headers).get('If-None-Match')
      return new Response(null, { status: 304, headers: { etag: '"v1"' } })
    }).fetch('"v1"')
    expect(header).toBe('"v1"')
    expect(result).toMatchObject({ ok: true, notModified: true, etag: '"v1"', bytes: 0 })
  })

  it.each([
    [new Response(null, { status: 500 }), { ok: false, reason: 'http', httpStatus: 500 }],
    [new Response('not-json', { status: 200 }), { ok: false, reason: 'invalid', httpStatus: null }],
  ])('When the source returns a non-JSON or error response Then classifies it safely', async (response, expected) => {
    expect(await source(async () => response).fetch(null)).toEqual(expected)
  })

  it('When fetch throws Then returns a network failure without raw error text', async () => {
    const result = await source(async () => { throw new Error('secret') }).fetch(null)
    expect(result).toEqual({ ok: false, reason: 'network', httpStatus: null })
  })

  it('When the response exceeds the byte gate Then returns too_large without parsing', async () => {
    const result = await createModelsDevSource({ fetchImpl: async () => new Response(JSON.stringify(payload)), maxBytes: 1, timeoutMs: 10 }).fetch(null)
    expect(result).toEqual({ ok: false, reason: 'too_large', httpStatus: null })
  })

  it('When a streamed body crosses the cap mid-read Then stops reading and returns too_large', async () => {
    let pulls = 0
    const result = await createModelsDevSource({
      timeoutMs: 50,
      maxBytes: 10,
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) {
          pulls += 1
          controller.enqueue(new TextEncoder().encode('{"a":1}'))
        },
      }), { status: 200 }),
    }).fetch(null)
    expect(result).toEqual({ ok: false, reason: 'too_large', httpStatus: null })
    expect(pulls).toBeLessThan(5)
  })

  it('When the body stalls Then the timeout still aborts the read instead of hanging', async () => {
    const started = Date.now()
    const result = await source(async (_url, init) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200, headers: { etag: '"v1"' } })
    }).fetch(null)
    expect(result).toEqual({ ok: false, reason: 'network', httpStatus: null })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('When a 200 arrives without an ETag Then stores null instead of the previous validator', async () => {
    const models = { anthropic: { id: 'anthropic', models: { x: { id: 'x', name: 'X', release_date: '2026-11-16' } } } }
    const result = await source(async () => new Response(JSON.stringify(models), { status: 200 })).fetch('"old"')
    expect(result).toMatchObject({ ok: true, notModified: false, etag: null })
  })
})

describe('Given the OpenRouter HTTP source adapter', () => {
  it('When a 200 list arrives Then requests the models endpoint and converts per-token prices', async () => {
    let url = ''
    const result = await createOpenRouterSource({
      fetchImpl: async (input) => {
        url = String(input)
        return new Response(JSON.stringify({
          data: [{ id: 'tencent/hy4-flash:free', name: 'Tencent: Hy4 flash', created: 1794838706, pricing: { prompt: '0', completion: '0' } }],
        }), { status: 200 })
      },
    }).fetch(null)
    expect(url).toBe('https://openrouter.ai/api/v1/models')
    expect(result).toMatchObject({ ok: true, notModified: false, etag: null })
    if (result.ok) expect(result.models?.[0]).toMatchObject({ canonicalId: 'tencent/hy4-flash', free: true, provider: 'openrouter' })
  })

  it('When OpenRouter has no ETag and returns 304 Then reports notModified with the previous validator', async () => {
    const result = await createOpenRouterSource({
      fetchImpl: async () => new Response(null, { status: 304 }),
    }).fetch('"old"')
    expect(result).toEqual({ ok: true, notModified: true, etag: '"old"', bytes: 0 })
  })

  it('When OpenRouter collapses to a broken 200 Then returns invalid', async () => {
    const result = await createOpenRouterSource({ fetchImpl: async () => new Response('{"total_count":0}', { status: 200 }) }).fetch(null)
    expect(result).toEqual({ ok: false, reason: 'invalid', httpStatus: null })
  })
})
