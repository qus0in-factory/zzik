import { describe, expect, it } from 'vitest'
import { decodeGoModels, decodeOllamaTags } from '../../../../worker/domain/trend/plan/decode'

describe('Given the OpenCode Go public model list', () => {
  it('When canonical ids and names arrive Then records catalog observations', () => {
    const decoded = decodeGoModels({
      object: 'list',
      data: [
        { id: 'deepseek-v4.1-flash', canonical_id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017' },
        { id: 'glm-5.3', name: 'GLM 5.3' },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.observations).toEqual([
      { plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog' },
      { plan: 'opencode-go', modelId: 'glm-5.3', displayName: 'GLM 5.3', source: 'go-models', confidence: 'catalog' },
    ])
  })

  it('When the same canonical id repeats Then keeps the first observation', () => {
    const decoded = decodeGoModels({
      data: [
        { id: 'a', canonical_id: 'x/y', name: 'First' },
        { id: 'b', canonical_id: 'x/y', name: 'Second' },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.observations).toHaveLength(1)
      expect(decoded.observations[0]?.displayName).toBe('First')
    }
  })

  it.each([
    ['empty object', {}],
    ['non-array data', { data: 'nope' }],
    ['garbage rows', { data: [1, 2] }],
  ])('When Go returns a broken 200 (%s) Then rejects it', (_label, input) => {
    expect(decodeGoModels(input)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When Go has an empty list Then returns a valid empty result', () => {
    expect(decodeGoModels({ object: 'list', data: [] })).toEqual({ ok: true, observations: [] })
  })
})

describe('Given the Ollama public tags list', () => {
  it('When names arrive Then records Ollama Cloud catalog observations', () => {
    const decoded = decodeOllamaTags({
      models: [
        { name: 'glm-5.3', size: 755433728000 },
        { model: 'mistral-large-4', size: 0 },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.observations).toEqual([
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog' },
      { plan: 'ollama-cloud', modelId: 'mistral-large-4', displayName: 'mistral-large-4', source: 'ollama-tags', confidence: 'catalog' },
    ])
  })

  it.each([
    ['empty object', {}],
    ['non-array models', { models: {} }],
    ['garbage rows', { models: ['x'] }],
  ])('When Ollama returns a broken 200 (%s) Then rejects it', (_label, input) => {
    expect(decodeOllamaTags(input)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('When Ollama has no models Then returns a valid empty result', () => {
    expect(decodeOllamaTags({ models: [] })).toEqual({ ok: true, observations: [] })
  })
})
