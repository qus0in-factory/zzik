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
        median_output_tokens_per_second: 84.5,
        median_time_to_first_token_seconds: 1.12,
      }],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded).toMatchObject({ version: '3.0', hasMore: true, page: 1, totalPages: 2 })
    expect(decoded.entries[0]).toMatchObject({
      slug: 'claude-fable-5', name: 'Claude Fable 5', creator: 'Anthropic',
      releaseDate: '2026-11-09', intelligenceIndex: 72, priceIn: 3, priceOut: 15,
      outputTokensPerSecond: 84.5, timeToFirstTokenSeconds: 1.12,
      domains: { engineering: 61, economics: 55 },
    })
    expect(decoded.entries[0]?.domains).not.toHaveProperty('coding')
  })

  it('When speed fields are nested under performance Then reads median output tokens and TTFT, not end-to-end', () => {
    const decoded = decodeAaPage({
      intelligence_index_version: '5',
      data: [{
        slug: 'nested/x',
        evaluations: { artificial_analysis_intelligence_index: 72 },
        performance: {
          median_output_tokens_per_second: 84.5,
          median_time_to_first_token_seconds: 1.12,
          median_time_to_first_answer_token_seconds: 2.5,
          median_end_to_end_response_time_seconds: 9.9,
        },
        performance_v3: {
          mean_output_tokens_per_second: 70,
          mean_time_to_first_token_seconds: 0.9,
        },
      }],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.entries[0]).toMatchObject({ outputTokensPerSecond: 84.5, timeToFirstTokenSeconds: 1.12 })
    expect(decoded.entries[0]?.timeToFirstTokenSeconds).not.toBe(9.9)
  })

  it('When only performance_v3 is present Then falls back to its mean fields', () => {
    const decoded = decodeAaPage({
      intelligence_index_version: '5',
      data: [{
        slug: 'v3/x',
        evaluations: { artificial_analysis_intelligence_index: 60 },
        performance_v3: { mean_output_tokens_per_second: 70, mean_time_to_first_token_seconds: 0.9 },
      }],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.entries[0]).toMatchObject({ outputTokensPerSecond: 70, timeToFirstTokenSeconds: 0.9 })
  })

  it('When cost per task is nested under the intelligence index cost Then it is decoded', () => {
    const decoded = decodeAaPage({
      intelligence_index_version: '5',
      data: [{
        slug: 'cost/x',
        evaluations: { artificial_analysis_intelligence_index: 70 },
        artificial_analysis_intelligence_index_cost: { total_cost: 8.4, cost_per_task: { total_cost: 0.42 } },
      }],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.entries[0]?.costPerTask).toBe(0.42)
  })

  it('When the source returns a numeric index version Then normalizes it to the stored string', () => {
    const decoded = decodeAaPage({ intelligence_index_version: 4.1, data: [
      { slug: 'example', model_creator: { name: 'Example' }, evaluations: { artificial_analysis_intelligence_index: 42 } },
    ] })
    expect(decoded).toMatchObject({ ok: true, version: '4.1', entries: [{ slug: 'example', intelligenceIndex: 42 }] })
    expect(decodeAaPage({ intelligence_index_version: Infinity, data: [] })).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeAaPage({ intelligence_index_version: NaN, data: [] })).toEqual({ ok: false, reason: 'invalid' })
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

const BOUNDS = { start: '2026-11-04', end: '2026-11-17' }

function row(day: string, permaslug: string, tokens = '100') {
  return { date: day, model_permaslug: permaslug, total_tokens: tokens }
}

describe('Given an OpenRouter rankings-daily response', () => {
  it('When rows arrive Then normalizes token strings and preserves meta as_of/version/start/end', () => {
    const decoded = decodeOrRankings({
      data: [
        { date: '2026-11-16', model_permaslug: 'a/x', total_tokens: '12345678901234567890' },
        { date: '2026-11-16', model_permaslug: 'other', total_tokens: 42 },
      ],
      meta: {
        as_of: '2026-11-17T04:00:00Z',
        version: '2026-11-17',
        start_date: '2026-11-04',
        end_date: '2026-11-17',
      },
    }, BOUNDS)
    expect(decoded).toEqual({
      ok: true,
      asOf: '2026-11-17T04:00:00Z',
      meta: { version: '2026-11-17', startDate: '2026-11-04', endDate: '2026-11-17' },
      rows: [
        { day: '2026-11-16', permaslug: 'a/x', totalTokens: '12345678901234567890' },
        { day: '2026-11-16', permaslug: 'other', totalTokens: '42' },
      ],
    })
  })

  it('When the response is structurally broken or a row is malformed Then rejects it', () => {
    expect(decodeOrRankings({})).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeOrRankings({ data: [{ date: '2026-11-16' }] })).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeOrRankings({ data: [{ date: 'bad', model_permaslug: 'a/x', total_tokens: '1' }] })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When a date is outside the requested 14-day range Then rejects the whole response', () => {
    expect(decodeOrRankings({ data: [row('2026-11-03', 'a/x')] }, BOUNDS)).toEqual({ ok: false, reason: 'invalid' })
    expect(decodeOrRankings({ data: [row('2026-11-18', 'a/x')] }, BOUNDS)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When the same day and model is duplicated Then rejects the whole response', () => {
    expect(decodeOrRankings({ data: [row('2026-11-16', 'a/x'), row('2026-11-16', 'a/x')] }, BOUNDS)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When a day has more than 51 rows Then rejects the whole response', () => {
    const rows = Array.from({ length: 52 }, (_, index) => row('2026-11-16', `m/${index}`))
    expect(decodeOrRankings({ data: rows }, BOUNDS)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When the response has more than 714 rows Then rejects before any storage call', () => {
    const rows = Array.from({ length: 715 }, (_, index) => row('2026-11-16', `m/${index}`))
    expect(decodeOrRankings({ data: rows }, BOUNDS)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When the response fills the fixed budget (14 days × 51 rows) Then accepts it', () => {
    const days = Array.from({ length: 14 }, (_, index) => `2026-11-${String(4 + index).padStart(2, '0')}`)
    const rows = days.flatMap((day) => Array.from({ length: 51 }, (_, index) => row(day, `m/${index}`)))
    const decoded = decodeOrRankings({ data: rows }, BOUNDS)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.rows).toHaveLength(714)
  })
})
