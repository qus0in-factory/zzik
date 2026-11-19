import { TREND_AA_COST_LIMIT, TREND_AA_INTELLIGENCE_LIMIT, TREND_AA_PANEL_LIMIT, TREND_AA_PRICE_LIMIT } from '../../../../shared/trend-contract'
import type { AaTrendModelItem, AaTrendResponse } from '../../../../shared/trend-contract'
import { composeNotableCitation, notableFamilyKey, notableFamilyName } from './citation'
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

/** 공개용으로 쓸 AA 상위 후보 수. 내부 저장만 하고 순위·점수는 공개하지 않는다. */
export const AA_NOTABLE_SCAN_N = 20

interface Family {
  name: string
  creator: string
}

/**
 * 공개용 주목 모델 인용: 상위 모델에서 계열별 대표를 뽑아 제작사가 섞이게 고른 뒤
 * 이름 알파벳 순으로 나열한 문장 하나. 순위·점수·지수 이름은 포함하지 않는다(§2.3(c), §2.4(b)).
 */
export function buildAaCitation(snapshot: AaSnapshot): string | null {
  const families = new Map<string, Family>()
  for (const { entry } of rankAa(snapshot.entries).slice(0, AA_NOTABLE_SCAN_N)) {
    const name = notableFamilyName(entry.name)
    const key = notableFamilyKey(entry.name)
    if (name === null || key === null || families.has(key)) continue
    families.set(key, { name, creator: entry.creator === '' ? 'unknown' : entry.creator })
  }
  if (families.size === 0) return null

  // 제작사별 목록을 번갈아 한 건씩 골라 같은 제작사가 독점하지 않게 한다.
  const byCreator = new Map<string, Family[]>()
  for (const family of families.values()) {
    const list = byCreator.get(family.creator) ?? []
    list.push(family)
    byCreator.set(family.creator, list)
  }
  const creators = [...byCreator.keys()]
  const picked: Family[] = []
  const target = Math.min(7, families.size)
  for (let round = 0; picked.length < target; round += 1) {
    let advanced = false
    for (const creator of creators) {
      const list = byCreator.get(creator)!
      if (round >= list.length) continue
      picked.push(list[round]!)
      advanced = true
      if (picked.length === target) break
    }
    if (!advanced) break
  }

  // 한 제작사가 과반이면 이름 수를 줄여 균형을 맞춘다(7개면 4개 이상이 과반).
  // 이름이 너무 길어 문장 상한을 넘어도 같은 방식으로 한 건씩 줄인다.
  for (let count = picked.length; count >= 1; count -= 1) {
    const counts = new Map<string, number>()
    for (const family of picked.slice(0, count)) counts.set(family.creator, (counts.get(family.creator) ?? 0) + 1)
    if (count > 1 && [...counts.values()].some((value) => value > Math.floor(count / 2))) continue
    const names = picked.slice(0, count).map((family) => family.name).sort((a, b) => a.localeCompare(b))
    const citation = composeNotableCitation(names)
    if (citation !== null) return citation
  }
  return null
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
    costPerTask: entry.costPerTask ?? null,
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
      costPerTask: row.costPerTask ?? null,
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
    costPerTask: row.costPerTask ?? null,
    releaseDate: row.releaseDate,
  }
}

/**
 * 내부 전용(/api/trend/aa, Access JWT 뒤) AA 표 데이터 구성.
 * 우리가 만든 종합 점수 없이 AA 원시 필드만으로 정렬한다(지능·작업당 비용·출력 단가 20, 속도·TTFT 10).
 */
export function buildAaTrendResponse(rows: readonly AaSnapshotRow[]): AaTrendResponse | null {
  if (rows.length === 0) return null
  const first = rows[0]!
  const items = rows.map(toTrendItem)
  const byIntelligence = [...items]
    .sort((a, b) => b.intelligenceIndex - a.intelligenceIndex || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_INTELLIGENCE_LIMIT)

  const priced = items.filter((item): item is AaTrendModelItem & { priceIn: number; priceOut: number } =>
    item.priceIn !== null && item.priceOut !== null)
  const priceLowest = [...priced]
    .sort((a, b) => a.priceOut - b.priceOut || a.priceIn - b.priceIn || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_PRICE_LIMIT)
  const costLowest = items
    .filter((item): item is AaTrendModelItem & { costPerTask: number } =>
      item.costPerTask !== null && item.costPerTask > 0)
    .sort((a, b) => a.costPerTask - b.costPerTask || a.slug.localeCompare(b.slug))
    .slice(0, TREND_AA_COST_LIMIT)

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
    costLowest,
    speedHighest,
    latencyLowest,
  }
}
