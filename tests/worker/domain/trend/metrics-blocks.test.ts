import { describe, expect, it } from 'vitest'
import { buildAaBlock, fromAaRows, rankAa, toAaRows } from '../../../../worker/domain/trend/metrics/aa'
import { buildOrBlock } from '../../../../worker/domain/trend/metrics/or'
import type { AaModelEntry, AaSnapshot, OrRankingRow } from '../../../../worker/domain/trend/metrics/types'

function aa(slug: string, index: number, releaseDate: string | null = '2026-11-01'): AaModelEntry {
  return {
    slug,
    name: slug,
    creator: slug.split('/')[0] ?? 'unknown',
    releaseDate,
    intelligenceIndex: index,
    priceIn: 1,
    priceOut: 2,
    domains: {},
  }
}

function snapshot(version: string, entries: AaModelEntry[]): AaSnapshot {
  return { version, entries }
}

describe('Given Artificial Analysis Intelligence Index ranking', () => {
  it('When entries have equal index Then sorts by release date desc and slug', () => {
    const ranked = rankAa([aa('b/x', 50, '2026-11-01'), aa('a/x', 50, '2026-11-02'), aa('c/x', 50, null)])
    expect(ranked.map((item) => item.entry.slug)).toEqual(['a/x', 'b/x', 'c/x'])
  })

  it('When no previous snapshot exists Then shows the current top 15 with no deltas and a baseline note', () => {
    const block = buildAaBlock({
      today: snapshot('3.0', Array.from({ length: 20 }, (_, index) => aa(`m/${index}`, 100 - index))),
      previous: null,
      asOf: '2026-11-17',
    })
    expect(block).toMatchObject({ id: 'aa-intelligence', status: 'ok', version: '3.0', note: 'baseline', asOf: '2026-11-17' })
    expect(block.entries).toHaveLength(15)
    expect(block.entries.every((entry) => entry.rankDelta === null && entry.kind === 'steady')).toBe(true)
    expect(block.attribution).toBe('Artificial Analysis — artificialanalysis.ai (Intelligence Index v3.0, 2026-11-17)')
  })

  it('When a model enters the top 15 Then marks it new-top and computes rank deltas', () => {
    const previous = snapshot('3.0', Array.from({ length: 15 }, (_, index) => aa(`old/${index}`, 100 - index)))
    const today = snapshot('3.0', [aa('new/x', 200), ...Array.from({ length: 14 }, (_, index) => aa(`old/${index}`, 99 - index))])
    const block = buildAaBlock({ today, previous, asOf: '2026-11-17' })
    expect(block.entries[0]).toMatchObject({ id: 'new/x', rank: 1, rankDelta: null, kind: 'new-top', index: 200 })
    expect(block.entries.find((entry) => entry.id === 'old/0')).toMatchObject({ rank: 2, rankDelta: -1, kind: 'steady' })
  })

  it('When a top-30 model moves by 3+ places Then includes it as moved; small moves stay out', () => {
    const previousEntries = Array.from({ length: 30 }, (_, index) => aa(`m/${index}`, 100 - index))
    const todayEntries = previousEntries.map((entry) => {
      if (entry.slug === 'm/5') return { ...entry, intelligenceIndex: 86.5 }
      if (entry.slug === 'm/25') return { ...entry, intelligenceIndex: 71.5 }
      if (entry.slug === 'm/10') return { ...entry, intelligenceIndex: 91.5 }
      return entry
    })
    const block = buildAaBlock({ today: snapshot('3.0', todayEntries), previous: snapshot('3.0', previousEntries), asOf: '2026-11-17' })
    expect(block.entries.find((entry) => entry.id === 'm/5')).toMatchObject({ rank: 14, rankDelta: -8, kind: 'moved' })
    expect(block.entries.find((entry) => entry.id === 'm/25')).toMatchObject({ rank: 29, rankDelta: -3, kind: 'moved' })
    expect(block.entries.find((entry) => entry.id === 'm/10')).toMatchObject({ rankDelta: 2, kind: 'steady' })
    expect(block.entries.filter((entry) => entry.rank > 15).every((entry) => entry.kind === 'moved')).toBe(true)
  })

  it('When the index version changes Then resets comparison and explains why', () => {
    const block = buildAaBlock({
      today: snapshot('4.0', [aa('a/x', 90), aa('b/x', 80)]),
      previous: snapshot('3.0', [aa('b/x', 99), aa('a/x', 98)]),
      asOf: '2026-11-17',
    })
    expect(block.note).toBe('version_changed')
    expect(block.entries.every((entry) => entry.rankDelta === null && entry.kind === 'steady')).toBe(true)
  })

  it('When snapshots are stored and read back Then round-trips the rankable fields', () => {
    const today = snapshot('3.0', [aa('a/x', 90)])
    const rows = toAaRows(today, '2026-11-17')
    expect(rows[0]).toMatchObject({ day: '2026-11-17', slug: 'a/x', indexVersion: '3.0' })
    expect(fromAaRows(rows, '3.0')).toEqual(today)
  })
})

describe('Given OpenRouter daily ranking aggregates', () => {
  const DAY = (offset: number) => new Date(Date.UTC(2026, 10, 17 + offset)).toISOString().slice(0, 10)
  function row(offset: number, permaslug: string, tokens: string): OrRankingRow {
    return { day: DAY(offset), permaslug, totalTokens: tokens }
  }

  it('When the previous 7 days exist Then computes share and shareDelta including other in the denominator', () => {
    const rows: OrRankingRow[] = [
      row(0, 'a/x', '600'), row(0, 'b/x', '200'), row(0, 'other', '200'),
      row(-7, 'a/x', '500'), row(-7, 'b/x', '300'), row(-7, 'other', '200'),
    ]
    const block = buildOrBlock({ rows, today: DAY(0), asOf: '2026-11-17T05:00:00Z' })
    expect(block.id).toBe('or-usage')
    expect(block.note).toBeUndefined()
    const a = block.entries.find((entry) => entry.id === 'a/x')
    expect(a).toMatchObject({ rank: 1, share7d: 0.6, kind: 'moved' })
    expect(a?.shareDelta).toBeCloseTo(0.1, 6)
    const b = block.entries.find((entry) => entry.id === 'b/x')
    expect(b).toMatchObject({ rank: 2, share7d: 0.2 })
    expect(b?.shareDelta).toBeCloseTo(-0.1, 6)
    expect(block.entries.some((entry) => entry.id === 'other')).toBe(false)
    expect(block.attribution).toContain('Licensed under CC BY 4.0')
  })

  it('When a model newly enters the top 10 Then marks it new-top; a 1pt move is moved', () => {
    const rows: OrRankingRow[] = [
      ...Array.from({ length: 10 }, (_, index) => row(-7, `old/${index}`, `${1000 - index * 10}`)),
      row(-7, 'other', '10000'),
      row(0, 'new/x', '5000'),
      row(0, 'old/0', '1000'),
      ...Array.from({ length: 8 }, (_, index) => row(0, `old/${index + 1}`, `${900 - index * 10}`)),
      row(0, 'other', '10000'),
    ]
    const block = buildOrBlock({ rows, today: DAY(0), asOf: '2026-11-17T05:00:00Z' })
    expect(block.entries[0]).toMatchObject({ id: 'new/x', rank: 1, rankDelta: null, kind: 'new-top' })
    const moved = block.entries.find((entry) => entry.kind === 'moved')
    expect(moved).toBeDefined()
    expect(Math.abs(moved!.shareDelta ?? 0)).toBeGreaterThanOrEqual(0.01)
  })

  it('When there are no previous-window rows Then shows the current top 10 with a baseline note', () => {
    const rows = [row(0, 'a/x', '100'), row(0, 'b/x', '50'), row(0, 'other', '50')]
    const block = buildOrBlock({ rows, today: DAY(0), asOf: '2026-11-17T05:00:00Z' })
    expect(block.note).toBe('baseline')
    expect(block.entries.map((entry) => entry.id)).toEqual(['a/x', 'b/x'])
    expect(block.entries.every((entry) => entry.rankDelta === null && entry.kind === 'steady')).toBe(true)
  })

  it('When token strings exceed Number precision Then compares with BigInt without loss', () => {
    const rows = [
      row(0, 'a/x', '9007199254740993'),
      row(0, 'b/x', '9007199254740992'),
      row(0, 'other', '1'),
      row(-7, 'b/x', '2'),
      row(-7, 'a/x', '1'),
      row(-7, 'other', '1'),
    ]
    const block = buildOrBlock({ rows, today: DAY(0), asOf: '2026-11-17T05:00:00Z' })
    expect(block.entries[0]?.id).toBe('a/x')
    expect(block.entries[1]?.id).toBe('b/x')
  })
})
