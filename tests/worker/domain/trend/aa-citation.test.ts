import { describe, expect, it } from 'vitest'
import { buildAaCitation } from '../../../../worker/domain/trend/metrics/aa'
import { validatedAaCitation } from '../../../../worker/domain/trend/metrics/citation'
import type { AaModelEntry, AaSnapshot } from '../../../../worker/domain/trend/metrics/types'

const entry = (slug: string, name: string, index: number, creator = 'Maker'): AaModelEntry => ({
  slug, name, creator, releaseDate: null, intelligenceIndex: index, priceIn: null, priceOut: null, domains: {},
})
const snapshot = (entries: AaModelEntry[]): AaSnapshot => ({ version: '5', entries })

describe('Given the AA notable-model citation', () => {
  it('When real-style ranked variants exist Then the sentence lists five normalized families in alphabetical order', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Claude Fable 5.2 (Max, Default Fallback)', 90, 'Anthropic'),
      entry('b', 'Claude Fable 5.2 (Xhigh, Default Fallback)', 89, 'Anthropic'),
      entry('c', 'Gemini 4 Carbon (High)', 88, 'Google'),
      entry('d', 'Claude Opus 5.5 (Max, Default Fallback)', 87, 'Anthropic'),
      entry('e', 'GPT-6 Astra (Max)', 86, 'OpenAI'),
      entry('f', 'GPT-6.1 Sol (Max)', 85, 'OpenAI'),
      entry('g', 'Gemini 4 Hydrogen (Xhigh)', 84, 'Google'),
    ]))
    expect(text).toBe('요즘 주목받는 모델로는 Claude Fable, Claude Opus, Gemini Carbon, Gemini Hydrogen, GPT Astra이(가) 있습니다.')
  })

  it('When the sentence is built Then it has no rank word, no number and no index name', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'GPT-6.1 Sol (Max)', 99, 'OpenAI'),
      entry('b', 'Claude Fable 5.2 (High)', 98, 'Anthropic'),
    ]))!
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(/1위|순위|지수|점수|Intelligence Index/)
    expect(text).toMatch(/^요즘 주목받는 모델로는 /)
    expect(text.endsWith('이(가) 있습니다.')).toBe(true)
  })

  it('When families have equal scores Then output order is alphabetical, not score order', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Zeta 4 Fusion (High)', 99, 'Maker A'),
      entry('b', 'Alpha 3 Prime (High)', 99, 'Maker B'),
      entry('c', 'Mid 2 Core (High)', 99, 'Maker C'),
    ]))!
    expect(text).toBe('요즘 주목받는 모델로는 Alpha Prime, Mid Core, Zeta Fusion이(가) 있습니다.')
  })

  it('When duplicate families exist Then only one representative per family is listed', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Claude Fable 5.2 (Max)', 90),
      entry('b', 'Claude Fable 5.1 (High)', 89),
      entry('c', 'Claude Fable 4.5 (Low)', 88),
    ]))!
    expect(text).toBe('요즘 주목받는 모델로는 Claude Fable이(가) 있습니다.')
  })

  it('When no entries exist Then no citation is produced', () => {
    expect(buildAaCitation(snapshot([]))).toBeNull()
  })

  it('When a legacy rank-and-score sentence is revalidated Then it is rejected', () => {
    expect(validatedAaCitation('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')).toBeNull()
  })

  it('When a valid notable sentence round-trips Then projection validation keeps it', () => {
    const text = '요즘 주목받는 모델로는 Claude Fable, GPT Sol이(가) 있습니다.'
    expect(validatedAaCitation(text)).toBe(text)
  })

  it.each([
    ['numbers', '요즘 주목받는 모델로는 GPT-6.1 Sol이(가) 있습니다.'],
    ['rank word', '요즘 주목받는 모델로는 1위 Sol이(가) 있습니다.'],
    ['unsorted', '요즘 주목받는 모델로는 Zeta, Alpha이(가) 있습니다.'],
    ['two sentences', '요즘 주목받는 모델로는 Alpha입니다. 둘째 문장이(가) 있습니다.'],
    ['bracketed name', '요즘 주목받는 모델로는 [Alpha]이(가) 있습니다.'],
  ])('When a stored citation contains %s Then it is rejected', (_name, text) => {
    expect(validatedAaCitation(text)).toBeNull()
  })
})
