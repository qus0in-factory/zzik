import { describe, expect, it } from 'vitest'
import { catStateOf, cardPresentation } from '../../../src/app/usage/card-presentation'

describe('Given the cat display state (app 판정)', () => {
  it('When the value is 0, null or missing Then sleeping regardless of recent change', () => {
    expect(catStateOf(0, 0.6)).toEqual({ mode: 'sleeping', lapSeconds: null })
    expect(catStateOf(null, 0.6)).toEqual({ mode: 'sleeping', lapSeconds: null })
  })
  it('When positive with no recent change Then idle (always shown, no running)', () => {
    expect(catStateOf(12, null)).toEqual({ mode: 'idle', lapSeconds: null })
  })
  it('When positive with a recent change Then running at that speed', () => {
    expect(catStateOf(12, 0.25)).toEqual({ mode: 'running', lapSeconds: 0.25 })
  })
})

describe('Given the card presentation', () => {
  it('When caution Then level, text and cat state come together', () => {
    expect(cardPresentation({ usedPercent: 60, elapsedPercent: 20 }, null)).toEqual({
      barLevel: 'caution',
      barLevelText: '주의',
      cat: { mode: 'idle', lapSeconds: null },
    })
  })
  it('When 0% Then neutral and a sleeping cat', () => {
    expect(cardPresentation({ usedPercent: 0, elapsedPercent: 50 }, 0.6)).toMatchObject({ barLevel: 'neutral', cat: { mode: 'sleeping' } })
  })
})
