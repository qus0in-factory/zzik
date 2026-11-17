import { describe, expect, it } from 'vitest'
import { barLevelOf, BAR_LEVEL_TEXT } from '@domain/usage/bar-level'

describe('Given the progress-bar level rule (사용률 vs 기간 경과율)', () => {
  it.each([
    [0, 50, 'neutral'],
    [0, null, 'neutral'],
    [30, 50, 'ok'],
    [50, 50, 'ok'],
    [51, 50, 'caution'],
    [89.9, 20, 'caution'],
    [90, 95, 'danger'],
    [100, 100, 'danger'],
    [120, 10, 'danger'],
    [10, 0, 'caution'],
  ] as const)('When used=%s and elapsed=%s Then %s', (used, elapsed, expected) => {
    expect(barLevelOf(used, elapsed)).toBe(expected)
  })

  it.each([
    [69.9, 'ok'],
    [70, 'caution'],
    [89.9, 'caution'],
    [90, 'danger'],
  ] as const)('When elapsed is unknown and used=%s Then absolute thresholds give %s', (used, expected) => {
    expect(barLevelOf(used, null)).toBe(expected)
    expect(barLevelOf(used, undefined)).toBe(expected)
  })

  it('When used is not a finite number Then neutral', () => {
    expect(barLevelOf(null, 10)).toBe('neutral')
    expect(barLevelOf(Number.NaN, 10)).toBe('neutral')
  })

  it('When describing levels Then every level has a text so color is never the only cue', () => {
    expect(BAR_LEVEL_TEXT).toEqual({ neutral: '사용 없음', ok: '여유', caution: '주의', danger: '위험' })
  })

  it.each([
    [92, 80, 30 * 86400, 'caution'],
    [92, 95, 30 * 86400, 'ok'],
    [92, null, 30 * 86400, 'caution'],
    [94.9, 95, 28 * 86400, 'ok'],
    [95, 99, 30 * 86400, 'danger'],
    [95, 99, 31 * 86400, 'danger'],
    [90, 95, 7 * 86400, 'danger'],
    [89.9, 95, 7 * 86400, 'ok'],
    [90, 95, 5 * 3600, 'danger'],
  ] as const)('When used=%s, elapsed=%s, cycleSeconds=%s Then %s', (used, elapsed, cycleSeconds, expected) => {
    expect(barLevelOf(used, elapsed, cycleSeconds)).toBe(expected)
  })
})
