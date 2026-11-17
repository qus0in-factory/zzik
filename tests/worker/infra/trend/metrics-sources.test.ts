import { describe, expect, it, vi } from 'vitest'
import { createAaSource, createOrRankingSource } from '../../../../worker/infra/trend/metrics-sources'

const NOW = Date.parse('2026-11-17T05:00:00.000Z')

describe('Given the Artificial Analysis metrics source', () => {
  it('When pages have has_more Then fetches every page with the API key and merges by slug', async () => {
    const calls: Array<{ url: string; key: string | null }> = []
    const source = createAaSource({
      apiKey: 'aa-secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        calls.push({ url, key: new Headers(init?.headers).get('x-api-key') })
        const page = url.endsWith('page=1') ? 1 : 2
        return new Response(JSON.stringify({
          intelligence_index_version: '3.0',
          pagination: { page, total_pages: 2, has_more: page === 1 },
          data: page === 1
            ? [{ slug: 'a/x', name: 'A', model_creator: { name: 'A' }, evaluations: { artificial_analysis_intelligence_index: 90 } }]
            : [{ slug: 'b/x', name: 'B', model_creator: { name: 'B' }, evaluations: { artificial_analysis_intelligence_index: 80 } }],
        }), { status: 200 })
      },
    })
    const result = await source.fetch(NOW)
    expect(calls).toEqual([
      { url: 'https://artificialanalysis.ai/api/v2/language/models/free?page=1', key: 'aa-secret' },
      { url: 'https://artificialanalysis.ai/api/v2/language/models/free?page=2', key: 'aa-secret' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.version).toBe('3.0')
      expect(result.snapshot.entries.map((entry) => entry.slug)).toEqual(['a/x', 'b/x'])
    }
  })

  it('When no key is configured Then does not call fetch and reports not_configured', async () => {
    const fetchImpl = vi.fn()
    const result = await createAaSource({ apiKey: '  ', fetchImpl }).fetch(NOW)
    expect(result).toEqual({ ok: false, reason: 'not_configured', httpStatus: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [429, 'rate_limited'],
    [401, 'unauthorized'],
    [500, 'http'],
  ])('When AA returns %i Then maps the failure without echoing the key', async (status, reason) => {
    const result = await createAaSource({
      apiKey: 'aa-secret',
      fetchImpl: async () => new Response('{"error":"x"}', { status }),
    }).fetch(NOW)
    expect(result).toEqual({ ok: false, reason, httpStatus: status })
    expect(JSON.stringify(result)).not.toContain('aa-secret')
  })

  it('When the body is not JSON Then reports invalid instead of throwing', async () => {
    const result = await createAaSource({ apiKey: 'aa-secret', fetchImpl: async () => new Response('nope', { status: 200 }) }).fetch(NOW)
    expect(result).toEqual({ ok: false, reason: 'invalid', httpStatus: null })
  })
})

describe('Given the OpenRouter rankings source', () => {
  it('When a 14-day range is requested Then sends the bearer key and date bounds and decodes rows', async () => {
    let url = ''
    let auth: string | null = null
    const source = createOrRankingSource({
      apiKey: 'or-secret',
      fetchImpl: async (input, init) => {
        url = String(input)
        auth = new Headers(init?.headers).get('Authorization')
        return new Response(JSON.stringify({
          data: [{ date: '2026-11-16', model_permaslug: 'a/x', total_tokens: '100' }],
          meta: { as_of: '2026-11-17T04:00:00Z' },
        }), { status: 200 })
      },
    })
    const result = await source.fetch(NOW)
    expect(url).toBe('https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=2026-11-04&end_date=2026-11-17')
    expect(auth).toBe('Bearer or-secret')
    expect(result).toMatchObject({ ok: true, snapshot: { asOf: '2026-11-17T04:00:00Z' } })
    if (result.ok) expect(result.snapshot.rows[0]).toEqual({ day: '2026-11-16', permaslug: 'a/x', totalTokens: '100' })
  })

  it('When no key is configured Then does not call fetch', async () => {
    const fetchImpl = vi.fn()
    const result = await createOrRankingSource({ apiKey: '', fetchImpl }).fetch(NOW)
    expect(result).toEqual({ ok: false, reason: 'not_configured', httpStatus: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'unauthorized'],
    [429, 'rate_limited'],
    [503, 'http'],
  ])('When OpenRouter returns %i Then maps the failure', async (status, reason) => {
    const result = await createOrRankingSource({ apiKey: 'or-secret', fetchImpl: async () => new Response('', { status }) }).fetch(NOW)
    expect(result).toEqual({ ok: false, reason, httpStatus: status })
  })

  it('When meta.as_of is missing Then falls back to the run time', async () => {
    const result = await createOrRankingSource({
      apiKey: 'or-secret',
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ date: '2026-11-16', model_permaslug: 'a/x', total_tokens: '1' }] }), { status: 200 }),
    }).fetch(NOW)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.snapshot.asOf).toBe(new Date(NOW).toISOString())
  })
})
