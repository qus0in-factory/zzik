import { describe, expect, it } from 'vitest'
import { gerbilStateOf, cardPresentation } from '../../../src/app/usage/card-presentation'

describe('Given the gerbil display state (app 판정)', () => {
  it('When the value is 0, null or missing Then sleeping regardless of recent change', () => {
    expect(gerbilStateOf(0, 0.6)).toEqual({ mode: 'sleeping', lapSeconds: null })
    expect(gerbilStateOf(null, 0.6)).toEqual({ mode: 'sleeping', lapSeconds: null })
  })
  it('When positive with no recent change Then idle (always shown, no running)', () => {
    expect(gerbilStateOf(12, null)).toEqual({ mode: 'idle', lapSeconds: null })
  })
  it('When positive with a recent change Then running at that speed', () => {
    expect(gerbilStateOf(12, 0.25)).toEqual({ mode: 'running', lapSeconds: 0.25 })
  })
})

describe('Given the card presentation', () => {
  it('When caution Then level, text and gerbil state come together', () => {
    expect(cardPresentation({ usedPercent: 60, elapsedPercent: 20 }, null)).toEqual({
      barLevel: 'caution',
      barLevelText: '주의',
      gerbil: { mode: 'idle', lapSeconds: null },
    })
  })
  it('When 0% Then neutral and a sleeping gerbil', () => {
    expect(cardPresentation({ usedPercent: 0, elapsedPercent: 50 }, 0.6)).toMatchObject({ barLevel: 'neutral', gerbil: { mode: 'sleeping' } })
  })
  it('When month or week cycleSeconds is given Then applies window-specific danger threshold', () => {
    expect(cardPresentation({ usedPercent: 92, elapsedPercent: 80, cycleSeconds: 30 * 86400 }, null)).toMatchObject({ barLevel: 'caution' })
    expect(cardPresentation({ usedPercent: 95, elapsedPercent: 98, cycleSeconds: 30 * 86400 }, null)).toMatchObject({ barLevel: 'danger' })
    expect(cardPresentation({ usedPercent: 90, elapsedPercent: 95, cycleSeconds: 7 * 86400 }, null)).toMatchObject({ barLevel: 'danger' })
  })
})
