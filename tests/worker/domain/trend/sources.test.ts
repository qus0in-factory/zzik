import { describe, expect, it } from 'vitest'
import { decodeModelsDev, decodeOpenRouterModels } from '../../../../worker/domain/trend/sources'

describe('Given models.dev api.json', () => {
  it('When provider models have day/month dates and costs Then normalizes canonical ids, creators and free/open flags', () => {
    const decoded = decodeModelsDev({
      anthropic: {
        id: 'anthropic',
        models: {
          'claude-x': { id: 'claude-x', name: 'Claude X', release_date: '2026-11-16', cost: { input: 0, output: 0 }, open_weights: false },
          'claude-y': { id: 'claude-y', name: 'Claude Y', release_date: '2026-11', cost: { input: 3, output: 15 }, canonical_model_id: 'anthropic/claude-y' },
        },
      },
      reseller: { models: { 'claude-y': { id: 'claude-y', name: 'Claude Y resold', release_date: '2026-11-15', canonical_model_id: 'anthropic/claude-y', cost: { input: 4, output: 16 } } } },
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value).toHaveLength(3)
    expect(decoded.value[0]).toMatchObject({ canonicalId: 'claude-x', creator: 'anthropic', releasePrecision: 'day', free: true, openWeights: false })
    expect(decoded.value[1]).toMatchObject({ canonicalId: 'anthropic/claude-y', creator: 'anthropic', releasePrecision: 'month', price: { input: 3, output: 15 } })
    expect(decoded.value[2]).toMatchObject({ provider: 'reseller', canonicalId: 'anthropic/claude-y', creator: 'anthropic' })
  })

  it('When the source is not an object or has malformed dates Then rejects or reports unknown precision', () => {
    expect(decodeModelsDev(null)).toEqual({ ok: false, reason: 'invalid_source' })
    const decoded = decodeModelsDev({ p: { models: { m: { id: 'm', release_date: '2026-13' } } } })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.value[0]).toMatchObject({ releaseDate: null, releasePrecision: 'unknown', price: null })
  })

  it.each([
    ['empty object', {}],
    ['error envelope', { error: 'synthetic' }],
    ['non-record providers', { providers: [] }],
    ['empty providers', { providers: {} }],
    ['providers without model containers', { a: { id: 'a' }, b: { models: 'nope' } }],
  ])('When the payload is a broken 200 (%s) Then classifies it as invalid_source', (_label, input) => {
    expect(decodeModelsDev(input)).toEqual({ ok: false, reason: 'invalid_source' })
  })

  it('When a structurally valid source has no models Then returns a valid empty result, not a failure', () => {
    expect(decodeModelsDev({ anthropic: { id: 'anthropic', models: {} } })).toEqual({ ok: true, value: [] })
  })
})

describe('Given OpenRouter /api/v1/models', () => {
  it('When :free and zero-priced models arrive Then converts per-token prices and marks expiration', () => {
    const decoded = decodeOpenRouterModels({
      data: [
        {
          id: 'google/gemma-4-31b-it:free',
          name: 'Google: Gemma 4 31B (free)',
          created: 1794000000,
          pricing: { prompt: '0', completion: '0' },
          hugging_face_id: 'google/gemma-4-31b-it',
          expiration_date: null,
        },
        {
          id: 'tencent/hy4-flash',
          name: 'Tencent: Hy4 flash',
          created: 1794838706,
          pricing: { prompt: '0.000000035', completion: '0.0000001405' },
          hugging_face_id: null,
          expiration_date: '2026-12-31',
        },
        {
          id: 'inclusionai/ling-3.2-flash:free',
          name: 'Ling 3.2 Flash (free)',
          created: 1794500000,
          pricing: { prompt: '0', completion: '0' },
          expiration_date: '2026-11-16',
        },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value).toHaveLength(3)
    expect(decoded.value[0]).toMatchObject({
      canonicalId: 'google/gemma-4-31b-it', modelId: 'google/gemma-4-31b-it:free', provider: 'openrouter',
      creator: 'google', free: true, price: { input: 0, output: 0 }, openWeights: true,
      releaseDate: new Date(1794000000 * 1000).toISOString().slice(0, 10), releasePrecision: 'day',
    })
    expect(decoded.value[1]).toMatchObject({ canonicalId: 'tencent/hy4-flash', free: false, price: { input: 0.035, output: 0.1405 }, openWeights: false })
    expect(decoded.value[1]?.expiresAtMs).toBe(Date.UTC(2026, 11, 31))
    expect(decoded.value[2]).toMatchObject({ free: true, expiresAtMs: Date.UTC(2026, 10, 16) })
  })

  it.each([
    ['empty object', {}],
    ['missing data', { total_count: 0 }],
    ['non-array data', { data: {} }],
    ['garbage rows', { data: ['x'] }],
  ])('When OpenRouter returns a broken 200 (%s) Then classifies it as invalid_source', (_label, input) => {
    expect(decodeOpenRouterModels(input)).toEqual({ ok: false, reason: 'invalid_source' })
  })
})
