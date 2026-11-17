import { describe, expect, it } from 'vitest'
import { decodeAaPage, decodeOrRankings } from '../../../../worker/domain/trend/metrics/decode'

describe('Given an Artificial Analysis models page', () => {
  it('When valid entries arrive Then decodes index, creator, prices, domains and pagination', () => {
    const decoded = decodeAaPage({
      tier: 'free',
      intelligence_index_version: '3.0',
      pagination: { page: 1, total_pages: 2, has_more: true },
      data: [{
        id: 'claude-fable-5',
        slug: 'claude-fable-5',
        name: 'Claude Fable 5',
        model_creator: { id: 'anthropic', name: 'Anthropic' },
        release_date: '2026-11-09',
        evaluations: {
          artificial_analysis_intelligence_index: 72,
          artificial_analysis_coding_index: null,
          artificial_analysis_engineering_index: 61,
          artificial_analysis_economics_index: 55,
        },
        pricing: { price_1m_input_tokens: 3, price_1m_output_tokens: 15 },
      }],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded).toMatchObject({ version: '3.0', hasMore: true, page: 1, totalPages: 2 })
    expect(decoded.entries[0]).toMatchObject({
      slug: 'claude-fable-5', name: 'Claude Fable 5', creator: 'Anthropic',
      releaseDate: '2026-11-09', intelligenceIndex: 72, priceIn: 3, priceOut: 15,
      domains: { engineering: 61, economics: 55 },
    })
    expect(decoded.entries[0]?.domains).not.toHaveProperty('coding')
  })

  it('When the version or data array is missing Then rejects the page', () => {
    expect(decodeAaPage({ data: [] })).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeAaPage({ intelligence_index_version: '3.0' })).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeAaPage({ intelligence_index_version: '3.0', data: [{}] })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When an entry has no intelligence index Then skips it but keeps the valid ones', () => {
    const decoded = decodeAaPage({
      intelligence_index_version: '3.0',
      data: [
        { slug: 'a/x', model_creator: { name: 'A' }, evaluations: { artificial_analysis_intelligence_index: 50 } },
        { slug: 'b/x', model_creator: { name: 'B' }, evaluations: { artificial_analysis_intelligence_index: null } },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.entries.map((entry) => entry.slug)).toEqual(['a/x'])
  })
})

describe('Given an OpenRouter rankings-daily response', () => {
  it('When rows arrive Then normalizes token strings and preserves as_of', () => {
    const decoded = decodeOrRankings({
      data: [
        { date: '2026-11-16', model_permaslug: 'a/x', total_tokens: '12345678901234567890' },
        { date: '2026-11-16', model_permaslug: 'other', total_tokens: 42 },
        { date: 'bad', model_permaslug: 'skip/x', total_tokens: '1' },
      ],
      meta: { as_of: '2026-11-17T04:00:00Z' },
    })
    expect(decoded).toEqual({
      ok: true,
      asOf: '2026-11-17T04:00:00Z',
      rows: [
        { day: '2026-11-16', permaslug: 'a/x', totalTokens: '12345678901234567890' },
        { day: '2026-11-16', permaslug: 'other', totalTokens: '42' },
      ],
    })
  })

  it('When the response is structurally broken Then rejects it', () => {
    expect(decodeOrRankings({})).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeOrRankings({ data: [{ date: '2026-11-16' }] })).toEqual({ ok: false, reason: 'invalid' })
  })
})
