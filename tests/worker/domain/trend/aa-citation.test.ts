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

  it('When the model name keeps a version dot Then it is preserved', () => {
    expect(buildAaCitation(snapshot([entry('a', 'GPT-5.4', 92)]), '2026-11-17'))
      .toBe('Artificial Analysis Intelligence Index 1위는 GPT-5.4 (92)입니다. (2026-11-17 기준)')
  })

  it.each([
    ['newline', 'Model A\n둘째 문장입니다.'],
    ['extra sentence', 'Model A입니다. 둘째 문장입니다.'],
    ['serialized array', '[{"id":"a","score":42}]'],
    ['serialized object', '{"id":"a","score":42}'],
    ['brackets', 'Model [A]'],
    ['too long', 'x'.repeat(81)],
  ])('When the model name contains %s Then no citation is produced', (_name, model) => {
    expect(buildAaCitation(snapshot([entry('a', model, 90)]), '2026-11-17')).toBeNull()
  })
})
