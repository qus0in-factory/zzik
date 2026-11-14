import { describe, expect, it } from 'vitest'
import {
  CHART_OVERFLOW_DASH,
  CHART_SLOT_DASH,
  CHART_Y_TICKS,
  chartPlot,
  dashForSlot,
  nearestIndex,
  slotForOrdinal,
  xForTime,
  xTickPositions,
  yForPercent,
  yTickPositions,
} from '@domain/usage/history/chart-geometry'

const plot = chartPlot(640, 240)

describe('Given chart geometry with a fixed 0~100% y axis', () => {
  it('Then the plot keeps room for y ticks on the left and end labels on the right', () => {
    expect(plot).toEqual({ x: 34, y: 10, width: 560, height: 206 })
    expect(plot.x + plot.width).toBeLessThan(640)
  })

  it('Then 0% is the bottom, 100% the top and out-of-range values are clamped', () => {
    expect(yForPercent(0, plot)).toBe(216)
    expect(yForPercent(100, plot)).toBe(10)
    expect(yForPercent(50, plot)).toBe(113)
    expect(yForPercent(104, plot)).toBe(10)
    expect(yForPercent(-5, plot)).toBe(216)
  })

  it('Then time maps linearly from..to onto the plot width', () => {
    expect(xForTime(1000, 1000, 2000, plot)).toBe(34)
    expect(xForTime(2000, 1000, 2000, plot)).toBe(594)
    expect(xForTime(1500, 1000, 2000, plot)).toBe(314)
    expect(xForTime(1500, 1500, 1500, plot)).toBe(34)
  })

  it('Then ticks are 0/25/50/75/100 and 5 evenly spaced x positions', () => {
    expect(CHART_Y_TICKS).toEqual([0, 25, 50, 75, 100])
    expect(yTickPositions(plot)).toEqual([216, 164.5, 113, 61.5, 10])
    expect(xTickPositions(plot)).toEqual([34, 174, 314, 454, 594])
  })

  it('Then nearestIndex is -1 when empty and picks the later index on a tie', () => {
    expect(nearestIndex([], 5)).toBe(-1)
    expect(nearestIndex([0, 10, 20], 15)).toBe(2)
    expect(nearestIndex([0, 10, 20], 4)).toBe(0)
    expect(nearestIndex([0, 10, 20], 20)).toBe(2)
  })

  it('Then slots follow seriesOrder ordinals, the ninth and later are 0, with the ADR dash table', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(slotForOrdinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0, 0])
    expect(CHART_SLOT_DASH).toEqual([null, null, null, '6 3', '2 3', '8 3 2 3', '1 3', '10 3'])
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(dashForSlot)).toEqual(CHART_SLOT_DASH)
    expect(dashForSlot(0)).toBe(CHART_OVERFLOW_DASH)
  })
})
