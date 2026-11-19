import { describe, expect, it } from 'vitest'
import { buildAaCitation } from '../../../../worker/domain/trend/metrics/aa'
import {
  composeNotableCitation,
  notableFamilyKey,
  notableFamilyName,
  parseNotableCitation,
  validatedAaCitation,
} from '../../../../worker/domain/trend/metrics/citation'
import type { AaModelEntry, AaSnapshot } from '../../../../worker/domain/trend/metrics/types'

const entry = (slug: string, name: string, index: number, creator = 'Maker'): AaModelEntry => ({
  slug, name, creator, releaseDate: null, intelligenceIndex: index, priceIn: null, priceOut: null, domains: {},
})
const snapshot = (entries: AaModelEntry[]): AaSnapshot => ({ version: '5', entries })
const PREFIX = '요즘 주목받는 모델은 '
const SUFFIX = ' 등입니다.'

describe('Given the AA notable-model citation', () => {
  it('When real-style ranked variants exist Then the sentence lists seven normalized families with top versions in alphabetical order', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Claude Fable 5.2 (Max, Default Fallback)', 90, 'Anthropic'),
      entry('b', 'Claude Fable 5.2 (Xhigh, Default Fallback)', 89, 'Anthropic'),
      entry('c', 'Gemini 4 Carbon (High)', 88, 'Google'),
      entry('d', 'Claude Opus 5.5 (Max, Default Fallback)', 87, 'Anthropic'),
      entry('e', 'GPT-6 Astra (Max)', 86, 'OpenAI'),
      entry('f', 'GPT-6.1 Sol (Max)', 85, 'OpenAI'),
      entry('g', 'Gemini 4 Hydrogen (Xhigh)', 84, 'Google'),
      entry('h', 'Claude Sonnet 5.5 (High)', 83, 'Anthropic'),
      entry('i', 'GPT-6.1 Terra (Max)', 82, 'OpenAI'),
      entry('j', 'Gemini 4 Carbon (Low)', 81, 'Google'),
    ]))
    expect(text).toBe(
      PREFIX + 'Claude Fable 5.2, Claude Opus 5.5, Claude Sonnet 5.5, Gemini 4 Carbon, Gemini 4 Hydrogen, GPT 6 Astra, GPT 6.1 Sol' + SUFFIX,
    )
    const parsed = parseNotableCitation(text!)!
    const creators: Record<string, number> = { Anthropic: 0, Google: 0, OpenAI: 0 }
    for (const name of parsed.names) {
      if (name.startsWith('Claude')) creators.Anthropic += 1
      else if (name.startsWith('Gemini')) creators.Google += 1
      else creators.OpenAI += 1
    }
    expect(Math.max(...Object.values(creators))).toBeLessThanOrEqual(3)
  })

  it('When the sentence is built Then it keeps version numbers but has no rank word, score or index name', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'GPT-6.1 Sol (Max)', 99, 'OpenAI'),
      entry('b', 'Claude Fable 5.2 (High)', 98, 'Anthropic'),
    ]))!
    expect(text).toBe(PREFIX + 'Claude Fable 5.2, GPT 6.1 Sol' + SUFFIX)
    expect(text).not.toMatch(/99|98|1위|순위|지수|점수|등입니다\s*\(/)
    expect(text.startsWith(PREFIX)).toBe(true)
    expect(text.endsWith(SUFFIX)).toBe(true)
  })

  it('When families have equal scores Then output order is alphabetical, not score order', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Zeta 4 Fusion (High)', 99, 'Maker A'),
      entry('b', 'Alpha 3 Prime (High)', 99, 'Maker B'),
      entry('c', 'Mid 2 Core (High)', 99, 'Maker C'),
    ]))!
    expect(text).toBe(PREFIX + 'Alpha 3 Prime, Mid 2 Core, Zeta 4 Fusion' + SUFFIX)
  })

  it('When duplicate families with different versions exist Then only the highest-ranked version is listed', () => {
    const text = buildAaCitation(snapshot([
      entry('a', 'Claude Fable 5.2 (Max)', 90),
      entry('b', 'Claude Fable 5.1 (High)', 89),
      entry('c', 'Claude Fable 4.5 (Low)', 88),
    ]))!
    expect(text).toBe(PREFIX + 'Claude Fable 5.2' + SUFFIX)
  })

  it('When raw model names are normalized Then version stays in the name and is stripped from the family key', () => {
    expect(notableFamilyName('Claude Opus 5.5 (Max, Default Fallback)')).toBe('Claude Opus 5.5')
    expect(notableFamilyName('GPT-6.2 Sol (High)')).toBe('GPT 6.2 Sol')
    expect(notableFamilyName('Gemini 4 Hydrogen (Xhigh)')).toBe('Gemini 4 Hydrogen')
    expect(notableFamilyKey('Claude Opus 5.5 (Max, Default Fallback)')).toBe('claude opus')
    expect(notableFamilyKey('Claude Opus 5.1 (Low)')).toBe('claude opus')
    expect(notableFamilyKey('GPT-6.2 Sol (High)')).toBe('gpt sol')
  })

  it('When no entries exist Then no citation is produced', () => {
    expect(buildAaCitation(snapshot([]))).toBeNull()
  })

  it('When a legacy rank-and-score sentence is revalidated Then it is rejected', () => {
    expect(validatedAaCitation('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')).toBeNull()
  })

  it('When a valid versioned or legacy versionless sentence round-trips Then parser and validation agree', () => {
    const versioned = PREFIX + 'Claude Opus 5.5, Gemini 4 Hydrogen, GPT 6.2 Sol' + SUFFIX
    expect(validatedAaCitation(versioned)).toBe(versioned)
    expect(parseNotableCitation(versioned)).toEqual({
      prefix: PREFIX,
      names: ['Claude Opus 5.5', 'Gemini 4 Hydrogen', 'GPT 6.2 Sol'],
      suffix: SUFFIX,
    })

    const legacy = PREFIX + 'Able, Baker, Charlie, Delta, Echo, Foxtrot, Golf' + SUFFIX
    expect(validatedAaCitation(legacy)).toBe(legacy)
    expect(parseNotableCitation(legacy)?.names).toEqual(['Able', 'Baker', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'])
    expect(parseNotableCitation(legacy)?.prefix).toBe(PREFIX)
  })

  it('When the citation would exceed the length cap Then it is rejected', () => {
    const long = 'x'.repeat(80)
    const names = Array.from({ length: 7 }, (_, index) => `${long} ${index + 1}`)
    expect(validatedAaCitation(PREFIX + 'A, B' + SUFFIX)).not.toBeNull()
    expect(validatedAaCitation(PREFIX + names.join(', ') + SUFFIX)).toBeNull()
  })

  it.each([
    ['unnormalized hyphen version', PREFIX + 'GPT-6.1 Sol' + SUFFIX],
    ['non-version number', PREFIX + 'Model 1..2' + SUFFIX],
    ['score suffix', PREFIX + 'Model 90점' + SUFFIX],
    ['number only', PREFIX + '90' + SUFFIX],
    ['parenthetical score', PREFIX + 'Model A (90)' + SUFFIX],
    ['parenthetical modifier', PREFIX + 'Model A (high)' + SUFFIX],
    ['duplicate family versions', PREFIX + 'Claude Fable 5.1, Claude Fable 5.2' + SUFFIX],
    ['rank word 1위', PREFIX + '1위 Sol' + SUFFIX],
    ['rank word 4위', PREFIX + '4위 Sol' + SUFFIX],
    ['unsorted', PREFIX + 'Zeta, Alpha' + SUFFIX],
    ['two sentences', PREFIX + 'Alpha입니다. 둘째 문장' + SUFFIX],
    ['bracketed name', PREFIX + '[Alpha]' + SUFFIX],
  ])('When a stored citation contains %s Then it is rejected', (_name, text) => {
    expect(validatedAaCitation(text)).toBeNull()
    expect(parseNotableCitation(text)).toBeNull()
    expect(composeNotableCitation(text.slice(PREFIX.length, -SUFFIX.length).split(', '))).toBeNull()
  })
})
