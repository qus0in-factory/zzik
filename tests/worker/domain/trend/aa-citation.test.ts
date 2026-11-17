import { describe, expect, it } from 'vitest'
import { buildAaCitation } from '../../../../worker/domain/trend/metrics/aa'
import type { AaModelEntry, AaSnapshot } from '../../../../worker/domain/trend/metrics/types'

const entry = (slug: string, name: string, index: number): AaModelEntry => ({
  slug, name, creator: '', releaseDate: null, intelligenceIndex: index, priceIn: null, priceOut: null, domains: {},
})
const snapshot = (entries: AaModelEntry[]): AaSnapshot => ({ version: '5', entries })

describe('Given the Artificial Analysis brief citation', () => {
  it('When scores exist Then it is one Korean sentence naming only the first place with the reference day', () => {
    const text = buildAaCitation(snapshot([entry('b', 'Model B', 80), entry('a', 'Model A', 90)]), '2026-11-17')
    expect(text).toBe('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')
    expect(text).not.toContain('Model B')
    expect(text).not.toContain('80')
  })

  it('When no scored entry exists Then no citation is produced', () => {
    expect(buildAaCitation(snapshot([]), '2026-11-17')).toBeNull()
  })

  it('When scores are decimals Then the value is rendered with one decimal place', () => {
    expect(buildAaCitation(snapshot([entry('a', 'Model A', 92.5)]), '2026-11-17'))
      .toBe('Artificial Analysis Intelligence Index 1위는 Model A (92.5)입니다. (2026-11-17 기준)')
  })
})
