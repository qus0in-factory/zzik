import { TREND_AA_PANEL_LIMIT } from '../../../../shared/trend-contract'
import type { AaTrendModelItem, AaTrendResponse } from '../../../../shared/trend-contract'
import { composeAaCitation } from './citation'
import type { AaModelEntry, AaSnapshot, AaSnapshotRow } from './types'

interface Ranked {
  entry: AaModelEntry
  rank: number
}

function compare(a: AaModelEntry, b: AaModelEntry): number {
  if (b.intelligenceIndex !== a.intelligenceIndex) return b.intelligenceIndex - a.intelligenceIndex
  const aDate = a.releaseDate === null ? '' : a.releaseDate
  const bDate = b.releaseDate === null ? '' : b.releaseDate
  if (aDate !== bDate) return bDate.localeCompare(aDate)
  return a.slug.localeCompare(b.slug)
}

export function rankAa(entries: readonly AaModelEntry[]): Ranked[] {
  return [...entries].sort(compare).map((entry, index) => ({ entry, rank: index + 1 }))
}

/**
 * 공개용 AA brief citation: 지표당 1위 한 건만 담은 완성 문장 하나.
 * 무료 API가 실제 제공하는 지표는 Intelligence 하나뿐이다(Time per Task·Cost per Task 필드 없음).
 * 점수·모델 id·순위는 별도 필드로 만들지 않고 문장 안에만 둔다(§2.3(c), §2.4(b)).
 */
export function buildAaCitation(snapshot: AaSnapshot, day: string): string | null {
  const top = rankAa(snapshot.entries)[0]
  if (top === undefined) return null
  return composeAaCitation({ name: top.entry.name, score: top.entry.intelligenceIndex, day })
}

export function toAaRows(snapshot: AaSnapshot, day: string): AaSnapshotRow[] {
  return snapshot.entries.map((entry) => ({
    day,
    slug: entry.slug,
    name: entry.name,
    creator: entry.creator,
    intelligenceIndex: entry.intelligenceIndex,
    domains: entry.domains,
    priceIn: entry.priceIn,
    priceOut: entry.priceOut,
    outputTokensPerSecond: entry.outputTokensPerSecond ?? null,
    timeToFirstTokenSeconds: entry.timeToFirstTokenSeconds ?? null,
    releaseDate: entry.releaseDate,
    indexVersion: snapshot.version,
  }))
}

export function fromAaRows(rows: readonly AaSnapshotRow[], version: string): AaSnapshot {
  return {
    version,
    entries: rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      creator: row.creator,
      releaseDate: row.releaseDate,
      intelligenceIndex: row.intelligenceIndex,
      priceIn: row.priceIn,
      priceOut: row.priceOut,
      outputTokensPerSecond: row.outputTokensPerSecond ?? null,
      timeToFirstTokenSeconds: row.timeToFirstTokenSeconds ?? null,
      domains: row.domains,
    })),
  }
}

function toTrendItem(row: AaSnapshotRow): AaTrendModelItem {
  return {
    slug: row.slug,
    name: row.name,
    creator: row.creator,
    intelligenceIndex: row.intelligenceIndex,
    priceIn: row.priceIn,
    priceOut: row.priceOut,
    outputTokensPerSecond: row.outputTokensPerSecond ?? null,
    timeToFirstTokenSeconds: row.timeToFirstTokenSeconds ?? null,
    releaseDate: row.releaseDate,
  }
}

/**
 * 내부 전용(/api/trend/aa, Access JWT 뒤) AA 표 데이터 구성.
 * 우리가 만든 종합 점수 없이 AA 원시 필드만으로 정렬해 상위/하위 10을 뽑는다.
 */
export function buildAaTrendResponse(rows: readonly AaSnapshotRow[]): AaTrendResponse | null {
  if (rows.length === 0) return null
  const first = rows[0]!
  const items = rows.map(toTrendItem)
  const byIntelligence = [...items]
    .sort((a, b) => b.intelligenceIndex - a.intelligenceIndex || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PANEL_LIMIT)

  const priced = items.filter((item): item is AaTrendModelItem & { priceIn: number; priceOut: number } =>
    item.priceIn !== null && item.priceOut !== null)
  const priceLowest = [...priced]
    .sort((a, b) => a.priceOut - b.priceOut || a.priceIn - b.priceIn || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PANEL_LIMIT)
  const priceHighest = [...priced]
    .sort((a, b) => b.priceOut - a.priceOut || b.priceIn - a.priceIn || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PANEL_LIMIT)

  const speedHighest = items
    .filter((item): item is AaTrendModelItem & { outputTokensPerSecond: number } =>
      item.outputTokensPerSecond !== null && item.outputTokensPerSecond > 0)
    .sort((a, b) => b.outputTokensPerSecond - a.outputTokensPerSecond || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PANEL_LIMIT)

  const latencyLowest = items
    .filter((item): item is AaTrendModelItem & { timeToFirstTokenSeconds: number } =>
      item.timeToFirstTokenSeconds !== null && item.timeToFirstTokenSeconds > 0)
    .sort((a, b) => a.timeToFirstTokenSeconds - b.timeToFirstTokenSeconds || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PANEL_LIMIT)

  return {
    day: first.day,
    indexVersion: first.indexVersion,
    attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
    intelligenceTop: byIntelligence,
    priceLowest,
    priceHighest,
    speedHighest,
    latencyLowest,
  }
}
