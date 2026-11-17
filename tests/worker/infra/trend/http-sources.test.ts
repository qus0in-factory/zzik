import { describe, expect, it } from 'vitest'
import payload from '../../../fixtures/trend/new-models.payload.json'
import { createModelsDevSource } from '../../../../worker/infra/trend/http-sources'

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
})
