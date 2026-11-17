import { describe, expect, it } from 'vitest'
import type { TrendMetricsEntry } from '@shared/trend-contract'
import {
  TREEMAP_STEPS,
  buildTreemapCells,
  compactModelName,
  displayModelName,
  stripDateSuffix,
  treemapCellLabel,
  treemapLabelStage,
  treemapStep,
  treemapTooltip,
  truncateLabel,
} from '@ui/trend/treemap-data'

function entry(overrides: Partial<TrendMetricsEntry> & Pick<TrendMetricsEntry, 'id' | 'name'>): TrendMetricsEntry {
  return {
    creator: 'creator', rank: 1, rankDelta: null, kind: 'steady', share7d: 0.1, ...overrides,
  } as TrendMetricsEntry
}

describe('Given the treemap data mapping', () => {
  it('When a model id has a date suffix Then strips it only from the display name', () => {
    expect(stripDateSuffix('deepseek/deepseek-v4.1-flash-20261017')).toBe('deepseek/deepseek-v4.1-flash')
    const node = entry({ id: 'deepseek/deepseek-v4.1-flash-20261017', name: 'deepseek/deepseek-v4.1-flash-20261017' })
    expect(displayModelName(node)).toBe('deepseek/deepseek-v4.1-flash')
    expect(compactModelName(node)).toBe('deepseek-v4.1-flash')
    expect(treemapTooltip(node).fullName).toBe('deepseek/deepseek-v4.1-flash-20261017')
    expect(treemapTooltip(node).displayName).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('When the entry is other Then uses the gray token and the 기타 label', () => {
    const cells = buildTreemapCells([
      entry({ id: 'a', name: 'a', share7d: 0.9 }),
      entry({ id: 'other', name: 'other', creator: null, rank: 2, share7d: 0.1, shareDelta: 0 }),
    ])
    const other = cells.find((cell) => cell.id === 'other')!
    expect(other.step).toBe('other')
    expect(other.fill).toBe('var(--muted)')
    expect(other.displayName).toBe('기타')
    expect(other.fullName).toBe('기타')
  })

  it('When shares are ranked Then sorts by share and maps 5 lightness steps', () => {
    const cells = buildTreemapCells([
      entry({ id: 'small', name: 'small', share7d: 0.01, rank: 3 }),
      entry({ id: 'max', name: 'max', share7d: 0.8, rank: 1 }),
      entry({ id: 'mid', name: 'mid', share7d: 0.19, rank: 2 }),
    ])
    expect(cells.map((cell) => cell.id)).toEqual(['max', 'mid', 'small'])
    expect(cells.map((cell) => cell.step)).toEqual([0, 2, 4])
    expect(cells[0]!.size).toBe(0.8)
    expect(treemapStep(0.8, 0.8)).toBe(0)
    expect(treemapStep(0.19, 0.8)).toBe(2)
    expect(treemapStep(0.01, 0.8)).toBe(4)
    expect(buildTreemapCells([entry({ id: 'zero', name: 'zero', share7d: 0 })])).toEqual([])
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
    for (const step of TREEMAP_STEPS) expect(contrast(step.background, step.foreground)).toBeGreaterThanOrEqual(4.5)
  })

  it('When a cell shrinks Then labels step down from full to share-only to none', () => {
    expect(treemapLabelStage(200, 100)).toBe('full')
    expect(treemapLabelStage(70, 32)).toBe('compact')
    expect(treemapLabelStage(32, 20)).toBe('share')
    expect(treemapLabelStage(20, 60)).toBe('share')
    expect(treemapLabelStage(20, 12)).toBe('none')
    expect(treemapLabelStage(0, 100)).toBe('none')
  })

  it('When a label is rendered Then each stage keeps the information that fits', () => {
    const cell = {
      displayName: 'deepseek/deepseek-v4.1-flash',
      compactName: 'deepseek-v4.1-flash',
      shareText: '점유율 28.8%',
      sharePercent: '28.8%',
      deltaText: '▲ 2.8pt',
    }
    expect(treemapCellLabel(cell, 220, 100).stage).toBe('full')
    expect(treemapCellLabel(cell, 220, 100).lines).toEqual([
      'deepseek/deepseek-v4.1-flash', '28.8%', '▲ 2.8pt',
    ])
    expect(treemapCellLabel(cell, 90, 40)).toEqual({ stage: 'compact', lines: ['deepseek-v4.…', '28.8%'], fontSize: 10, rotate: false })
    expect(treemapCellLabel(cell, 30, 20)).toEqual({ stage: 'share', lines: ['28.8%'], fontSize: 10, rotate: false })
    expect(treemapCellLabel(cell, 20, 60)).toEqual({ stage: 'share', lines: ['28.8%'], fontSize: 9, rotate: true })
    expect(treemapCellLabel(cell, 20, 12)).toEqual({ stage: 'none', lines: [], fontSize: 10, rotate: false })
  })

  it('When a name is wider than the cell Then truncates with an ellipsis', () => {
    expect(truncateLabel('abcdefghij', 40, 10)).toBe('abcde…')
    expect(truncateLabel('짧은이름', 100, 10)).toBe('짧은이름')
    expect(truncateLabel('abcdefghij', 0, 10)).toBe('')
  })
})
