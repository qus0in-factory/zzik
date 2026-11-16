import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { xAxisValues } from '@ui/usage/history/chart-uplot-options'
const originalZone = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Seoul' })
afterAll(() => { if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone })
const seconds = (iso: string) => Date.parse(iso) / 1000

describe('Given a fitted time axis in Asia/Seoul', () => {
  it('When local midnight is crossed Then the new date appears exactly at midnight', () => {
    const splits = ['2026-11-15T14:59:00Z','2026-11-15T15:00:00Z','2026-11-15T15:01:00Z'].map(seconds)
    expect(xAxisValues('24h')(null,splits)).toEqual(['11/15 23:59','11/16 00:00','00:01'])
  })
  it('When only the UTC date changes Then the local day label is not repeated', () => {
    const splits = ['2026-11-15T23:59:00Z','2026-11-16T00:00:00Z'].map(seconds)
    expect(xAxisValues('24h')(null,splits)).toEqual(['11/16 08:59','09:00'])
  })
})
