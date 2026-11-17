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
      domains: row.domains,
    })),
  }
}
