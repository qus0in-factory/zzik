import { composeNotableCitation, notableFamilyName } from './citation'
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
    if (name === null) continue
    const key = name.toLowerCase()
    if (families.has(key)) continue
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
  for (let round = 0; picked.length < 5; round += 1) {
    let advanced = false
    for (const creator of creators) {
      const list = byCreator.get(creator)!
      if (round >= list.length) continue
      picked.push(list[round]!)
      advanced = true
      if (picked.length === 5) break
    }
    if (!advanced) break
  }

  const names = picked.map((family) => family.name).sort((a, b) => a.localeCompare(b))
  return composeNotableCitation(names)
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
