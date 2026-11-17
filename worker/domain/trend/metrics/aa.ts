import {
  TREND_AA_MOVE_RANK_MAX,
  TREND_AA_MOVE_THRESHOLD,
  TREND_AA_TOP_N,
} from '../../../../shared/trend-contract'
import type { TrendMetricsBlock, TrendMetricsEntry } from '../../../../shared/trend-contract'
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

export function aaAttribution(version: string, asOf: string): string {
  return `Artificial Analysis — artificialanalysis.ai (Intelligence Index v${version}, ${asOf})`
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

/**
 * AA Intelligence Index 순위와 7일 전 대비 변동.
 * - 상위 15위는 항상 노출하고, 7일 전에 없던 모델은 `new-top`.
 * - 16~30위는 ±3위 이상 움직인 경우만 `moved`로 추가한다.
 * - 이전 스냅샷이 없거나 지수 버전이 바뀌면 delta를 계산하지 않고 note로 알린다.
 */
export function buildAaBlock(input: { today: AaSnapshot; previous: AaSnapshot | null; asOf: string }): TrendMetricsBlock {
  const ranked = rankAa(input.today.entries)
  const comparable = input.previous !== null && input.previous.version === input.today.version
  const previousRank = new Map<string, number>()
  if (comparable && input.previous !== null) {
    for (const { entry, rank } of rankAa(input.previous.entries)) previousRank.set(entry.slug, rank)
  }

  const entries: TrendMetricsEntry[] = []
  for (const { entry, rank } of ranked) {
    const prev = previousRank.get(entry.slug)
    const delta = comparable && prev !== undefined ? prev - rank : null
    if (rank <= TREND_AA_TOP_N) {
      const kind = !comparable ? 'steady' : prev === undefined ? 'new-top' : delta !== null && Math.abs(delta) >= TREND_AA_MOVE_THRESHOLD ? 'moved' : 'steady'
      entries.push({
        id: entry.slug,
        name: entry.name,
        creator: entry.creator === '' ? null : entry.creator,
        rank,
        rankDelta: delta,
        kind,
        index: entry.intelligenceIndex,
      })
      continue
    }
    if (rank > TREND_AA_MOVE_RANK_MAX || !comparable || prev === undefined || delta === null) continue
    if (Math.abs(delta) < TREND_AA_MOVE_THRESHOLD) continue
    entries.push({
      id: entry.slug,
      name: entry.name,
      creator: entry.creator === '' ? null : entry.creator,
      rank,
      rankDelta: delta,
      kind: 'moved',
      index: entry.intelligenceIndex,
    })
  }

  const note = input.previous === null ? 'baseline' : comparable ? undefined : 'version_changed'
  return {
    id: 'aa-intelligence',
    status: 'ok',
    asOf: input.asOf,
    version: input.today.version,
    ...(note === undefined ? {} : { note }),
    entries,
    attribution: aaAttribution(input.today.version, input.asOf),
  }
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
