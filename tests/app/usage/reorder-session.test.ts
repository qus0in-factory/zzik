import { describe, expect, it } from 'vitest'
import { nearestIndex, shiftDirection, stepIndex } from '@app/usage/reorder-session'

describe('Given the drag target calculation', () => {
  it('When the dragged center is between chip centers Then the nearest chip index wins', () => {
    const centers = [50, 150, 250, 350]
    expect(nearestIndex(centers, 40)).toBe(0)
    expect(nearestIndex(centers, 101)).toBe(1)
    expect(nearestIndex(centers, 99)).toBe(0)
    expect(nearestIndex(centers, 999)).toBe(3)
    expect(nearestIndex([], 10)).toBe(0)
  })
  it('When the dragged chip moves right Then chips between origin (exclusive) and target (inclusive) shift left', () => {
    const shifts = [0, 1, 2, 3, 4].map((index) => shiftDirection(index, 1, 3))
    expect(shifts).toEqual([0, 0, -1, -1, 0])
  })
  it('When the dragged chip moves left Then chips from target (inclusive) to origin (exclusive) shift right', () => {
    const shifts = [0, 1, 2, 3, 4].map((index) => shiftDirection(index, 3, 1))
    expect(shifts).toEqual([0, 1, 1, 0, 0])
  })
  it('When nothing moved Then no chip shifts', () => {
    expect([0, 1, 2].map((index) => shiftDirection(index, 1, 1))).toEqual([0, 0, 0])
  })
  it('When stepping by keyboard Then the index is clamped to the visible chips', () => {
    expect(stepIndex(0, -1, 4)).toBe(0)
    expect(stepIndex(3, 1, 4)).toBe(3)
    expect(stepIndex(1, 1, 4)).toBe(2)
  })
})
