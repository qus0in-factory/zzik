import { describe, expect, it } from 'vitest'
import type { TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import { TREND_NEW_MODELS_RULE } from '../../../../shared/trend-contract'
import { buildNewModels } from '../../../../worker/domain/trend/sections/new-models'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

function record(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'anthropic/claude-fable-5',
    provider: 'anthropic',
    modelId: 'claude-fable-5',
    name: 'Claude Fable 5',
    creator: 'anthropic',
    releaseDate: '2026-11-09',
    releasePrecision: 'day',
    releaseMs: Date.UTC(2026, 10, 9),
    price: { input: 3, output: 15 },
    free: false,
    openWeights: false,
    status: null,
    expiresAtMs: null,
    ...overrides,
  }
}

function openrouter(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return record({
    provider: 'openrouter',
    releaseDate: '2026-11-15',
    releaseMs: NOW - 2 * DAY,
    ...overrides,
  })
}

const sources: TrendSourceState[] = [
  { id: 'models.dev', fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
  { id: 'openrouter', fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
]

function build(input: {
  modelsDev?: TrendModelRecord[] | null
  openrouter?: TrendModelRecord[] | null
  previous?: TrendSectionPayload | null
  sourceStates?: TrendSourceState[]
}) {
  return buildNewModels({
    modelsDev: input.modelsDev ?? null,
    openrouter: input.openrouter ?? null,
    previous: input.previous ?? null,
    sources: input.sourceStates ?? sources,
    nowMs: NOW,
  })
}

describe('Given the OpenRouter registration-based new-models builder', () => {
  it('When an OpenRouter created time is within 7 days Then includes it with an OpenRouter badge', () => {
    const payload = build({ openrouter: [openrouter()] })
    expect(payload.rule).toBe(TREND_NEW_MODELS_RULE)
    expect(payload.sources).toEqual(sources)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
      registeredIn: ['openrouter'],
    })
  })

  it('When a model is only newly released in models.dev but absent from OpenRouter Then excludes it', () => {
    const payload = build({ modelsDev: [record({ releaseDate: '2026-11-16', releaseMs: NOW - DAY })], openrouter: [] })
    expect(payload.items).toEqual([])
  })

  it('When OpenRouter and models.dev share a canonical id Then enriches metadata but keeps only the OpenRouter badge', () => {
    const payload = build({ modelsDev: [record()], openrouter: [openrouter({ name: 'Claude Fable 5 (OpenRouter)' })] })
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
      releaseDate: '2026-11-09', registeredIn: ['openrouter'],
    })
  })

  it('When an OpenRouter-only model matches models.dev by name Then enriches its metadata', () => {
    const payload = build({
      modelsDev: [record()],
      openrouter: [openrouter({
        canonicalId: 'reseller/claude-fable-5', modelId: 'reseller-claude', name: 'Claude Fable 5',
      })],
    })
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic', registeredIn: ['openrouter'],
    })
  })

  it('When the OpenRouter registration is older than 7 days Then excludes it', () => {
    const payload = build({ openrouter: [openrouter({ releaseDate: '2026-11-09', releaseMs: NOW - 8 * DAY })] })
    expect(payload.items).toEqual([])
  })

  it('When OpenRouter is unavailable on a later run Then carries previous OpenRouter items and filters the window', () => {
    const previous = build({ openrouter: [openrouter()] })
    const payload = build({ modelsDev: [record()], openrouter: null, previous })
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({ id: 'anthropic/claude-fable-5', registeredIn: ['openrouter'] })
  })

  it('When previous items are older than 7 days Then drops them on a 304/failure run', () => {
    const previous = build({ openrouter: [openrouter()] })
    const later = buildNewModels({ modelsDev: null, openrouter: null, previous, sources, nowMs: NOW + 8 * DAY })
    expect(later.items).toEqual([])
  })
})
