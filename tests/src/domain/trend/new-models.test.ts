import { describe, expect, it } from 'vitest'
import type { TrendItem } from '@shared/trend-contract'
import { NEW_MODELS_PAGE_SIZE, sortNewModelsByLatest } from '@domain/trend/new-models'

function item(id: string, releaseDate: string | null): TrendItem {
  return {
    id,
    name: id,
    creator: 'test',
    releaseDate,
    precision: releaseDate === null ? 'unknown' : 'day',
    price: null,
    free: false,
    openWeights: false,
    providers: ['openrouter'],
    links: {},
    registeredIn: ['openrouter'],
  }
}

describe('Given client-side new-models sorting and page size', () => {
  it('When items have mixed release dates and nulls Then orders latest releaseDate first and keeps server registration order on ties or nulls', () => {
    const input = [
      item('server-0-null', null),
      item('server-1-old', '2026-11-10'),
      item('server-2-latest-a', '2026-11-16'),
      item('server-3-latest-b', '2026-11-16'),
      item('server-4-mid', '2026-11-14'),
      item('server-5-null', null),
    ]

    expect(NEW_MODELS_PAGE_SIZE).toBe(6)
    expect(sortNewModelsByLatest(input).map((entry) => entry.id)).toEqual([
      'server-2-latest-a',
      'server-3-latest-b',
      'server-4-mid',
      'server-1-old',
      'server-0-null',
      'server-5-null',
    ])
  })
})
