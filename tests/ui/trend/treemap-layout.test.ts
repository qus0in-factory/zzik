import { describe, expect, it } from 'vitest'
import { TREEMAP_STEPS, shouldShowTreemapLabel, squarify, treemapStep } from '@ui/trend/treemap-layout'

describe('Given the squarified treemap layout', () => {
  it('When values are 60/25/8 Then returns one rect per item with proportional areas inside the box', () => {
    const rects = squarify([
      { id: 'deepseek', value: 0.6 },
      { id: 'qwen', value: 0.25 },
      { id: 'tencent', value: 0.08 },
    ], 100, 56.25)
    expect(rects).toHaveLength(3)
    const total = rects.reduce((sum, rect) => sum + rect.width * rect.height, 0)
    expect(total).toBeCloseTo(100 * 56.25, 4)
    const areas = rects.map((rect) => ({ id: rect.id, area: rect.width * rect.height }))
    expect(areas[0]!.id).toBe('deepseek')
    expect(areas[1]!.id).toBe('qwen')
    expect(areas[2]!.id).toBe('tencent')
    expect(areas[0]!.area).toBeGreaterThan(areas[1]!.area)
    expect(areas[1]!.area).toBeGreaterThan(areas[2]!.area)
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(100.0001)
      expect(rect.y + rect.height).toBeLessThanOrEqual(56.2501)
    }
  })

  it('When values are zero or negative Then ignores them and returns an empty layout for no positives', () => {
    expect(squarify([{ id: 'a', value: 0 }, { id: 'b', value: -1 }], 100, 56.25)).toEqual([])
    const rects = squarify([{ id: 'a', value: 0 }, { id: 'b', value: 2 }], 100, 56.25)
    expect(rects.map((rect) => rect.id)).toEqual(['b'])
    expect(rects[0]!.width * rects[0]!.height).toBeCloseTo(100 * 56.25, 4)
  })

  it('When shares are ranked against the max Then maps to 5 lightness steps', () => {
    expect(treemapStep(0.18, 0.18)).toBe(0)
    expect(treemapStep(0.12, 0.18)).toBe(0)
    expect(treemapStep(0.09, 0.18)).toBe(1)
    expect(treemapStep(0.06, 0.18)).toBe(2)
    expect(treemapStep(0.03, 0.18)).toBe(3)
    expect(treemapStep(0.005, 0.18)).toBe(4)
    expect(treemapStep(0, 0)).toBe(4)
  })

  it('When text sits on a palette step Then contrast stays at least 4.5:1', () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
    }
    const contrast = (a: string, b: string): number => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (light! + 0.05) / (dark! + 0.05)
    }
    expect(TREEMAP_STEPS).toHaveLength(5)
    for (const step of TREEMAP_STEPS) {
      expect(contrast(step.background, step.foreground)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('When a cell is tiny Then hides the label while large cells keep it', () => {
    const rects = squarify([
      { id: 'large', value: 0.99 },
      { id: 'tiny', value: 0.01 },
    ], 100, 56.25)
    const large = rects.find((rect) => rect.id === 'large')!
    const tiny = rects.find((rect) => rect.id === 'tiny')!
    expect(shouldShowTreemapLabel(large)).toBe(true)
    expect(shouldShowTreemapLabel(tiny)).toBe(false)
  })
})
