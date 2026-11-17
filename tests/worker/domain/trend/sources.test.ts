import { describe, expect, it } from 'vitest'
import { decodeModelsDev } from '../../../../worker/domain/trend/sources'

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
})
