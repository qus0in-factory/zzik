/**
 * `new-models` 섹션: 최근 7일 안에 Artificial Analysis 또는 OpenRouter에 새로 등록된 모델.
 * AA는 models.dev release_date(일 단위)를, OpenRouter는 `/models`의 created를 등록 시각으로 쓴다.
 * models.dev는 이름·제작사·가격 등 메타 보강에만 쓴다.
 */
import {
  TREND_NEW_MODELS_RULE,
  TREND_NEW_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendPrice, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'

type RegisteredSource = 'aa' | 'openrouter'

const MAX_ITEMS = 50
const DEPRECATED = new Set(['deprecated', 'retired'])

export interface NewModelsInput {
  /** models.dev 200 응답. 304·실패면 null이고 이전 AA 항목을 재사용한다. */
  modelsDev: readonly TrendModelRecord[] | null
  /** OpenRouter 200 응답. 304·실패면 null이고 이전 OpenRouter 항목을 재사용한다. */
  openrouter: readonly TrendModelRecord[] | null
  previous: TrendSectionPayload | null
  sources: readonly TrendSourceState[]
  nowMs: number
}

function unionBadges(existing: TrendItem['registeredIn'], add: RegisteredSource): RegisteredSource[] {
  return [...new Set<RegisteredSource>([...(existing ?? []), add])]
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function pickRelease(group: readonly TrendModelRecord[]): Pick<TrendItem, 'releaseDate' | 'precision'> {
  const day = group
    .filter((record) => record.releasePrecision === 'day' && record.releaseMs !== null)
    .sort((a, b) => (b.releaseMs ?? 0) - (a.releaseMs ?? 0))[0]
  if (day !== undefined) return { releaseDate: day.releaseDate, precision: 'day' }
  const month = group.find((record) => record.releasePrecision === 'month')
  if (month !== undefined) return { releaseDate: month.releaseDate, precision: 'month' }
  return { releaseDate: null, precision: 'unknown' }
}

function representative(group: readonly TrendModelRecord[]): TrendModelRecord {
  return group.find((record) => record.price !== null) ?? group[0]!
}

function inWindow(ms: number | null, nowMs: number): boolean {
  return ms !== null && ms >= nowMs - TREND_NEW_MODELS_WINDOW_MS && ms <= nowMs
}

function groupByCanonical(records: readonly TrendModelRecord[]): Map<string, TrendModelRecord[]> {
  const groups = new Map<string, TrendModelRecord[]>()
  for (const record of records) {
    if (record.status !== null && DEPRECATED.has(record.status)) continue
    const group = groups.get(record.canonicalId)
    if (group === undefined) groups.set(record.canonicalId, [record])
    else group.push(record)
  }
  return groups
}

function catalogIndex(groups: Map<string, TrendModelRecord[]>): {
  byName: Map<string, string>
  byModelId: Map<string, string>
} {
  const byName = new Map<string, string>()
  const byModelId = new Map<string, string>()
  for (const [canonicalId, group] of groups) {
    for (const record of group) {
      if (!byName.has(normalizeName(record.name))) byName.set(normalizeName(record.name), canonicalId)
      if (!byModelId.has(normalizeName(record.modelId))) byModelId.set(normalizeName(record.modelId), canonicalId)
    }
  }
  return { byName, byModelId }
}

function matchCanonical(record: TrendModelRecord, groups: Map<string, TrendModelRecord[]>, index: { byName: Map<string, string>; byModelId: Map<string, string> }): string | null {
  if (groups.has(record.canonicalId)) return record.canonicalId
  return index.byName.get(normalizeName(record.name)) ?? index.byModelId.get(normalizeName(record.modelId)) ?? null
}

function makeItem(input: {
  metadata: readonly TrendModelRecord[]
  badges: ('aa' | 'openrouter')[]
  aaMs: number
  orMs: number
}): TrendItem & { sortMs: number } {
  const chosen = representative(input.metadata)
  const release = pickRelease(input.metadata)
  const providers = [...new Set(input.metadata.map((record) => record.provider))].sort()
  const price: TrendPrice | null = chosen.price
  return {
    id: chosen.canonicalId,
    name: chosen.name,
    creator: chosen.creator,
    releaseDate: release.releaseDate,
    precision: release.precision,
    price,
    free: price !== null && price.input === 0 && price.output === 0,
    openWeights: input.metadata.some((record) => record.openWeights),
    providers,
    links: {},
    registeredIn: input.badges,
    extra: { aaMs: input.aaMs, orMs: input.orMs },
    sortMs: Math.max(input.aaMs, input.orMs),
  }
}

function carriedItems(previous: TrendSectionPayload | null, source: 'aa' | 'openrouter', nowMs: number): Array<TrendItem & { sortMs: number }> {
  if (previous === null) return []
  const items: Array<TrendItem & { sortMs: number }> = []
  for (const item of previous.items) {
    if (!Array.isArray(item.registeredIn) || !item.registeredIn.includes(source)) continue
    const aaMs = typeof item.extra?.aaMs === 'number' ? item.extra.aaMs : 0
    const orMs = typeof item.extra?.orMs === 'number' ? item.extra.orMs : 0
    if (!inWindow(aaMs, nowMs) && !inWindow(orMs, nowMs)) continue
    const badges = (['aa', 'openrouter'] as const).filter((badge) => (badge === 'aa' ? inWindow(aaMs, nowMs) : inWindow(orMs, nowMs)))
    items.push({ ...item, registeredIn: [...badges], extra: { ...item.extra, aaMs, orMs }, sortMs: Math.max(aaMs, orMs) })
  }
  return items
}

/** AA/OpenRouter 등록 후보를 canonical id로 합치고 모델 메타를 models.dev에서 보강한다. */
export function buildNewModels(input: NewModelsInput): TrendSectionPayload {
  const { nowMs } = input
  const devGroups = groupByCanonical(input.modelsDev ?? [])
  const index = catalogIndex(devGroups)
  const orGroups = groupByCanonical(input.openrouter ?? [])

  const aaIds = new Set<string>()
  for (const [id, group] of devGroups) {
    const releaseMs = group.reduce((max, record) => Math.max(max, record.releasePrecision === 'day' ? record.releaseMs ?? 0 : 0), 0)
    if (inWindow(releaseMs, nowMs)) aaIds.add(id)
  }
  const orIds = new Set<string>()
  for (const [id, group] of orGroups) {
    const createdMs = group.reduce((max, record) => Math.max(max, record.releaseMs ?? 0), 0)
    if (inWindow(createdMs, nowMs)) orIds.add(id)
  }

  const allIds = new Set<string>([...aaIds, ...orIds])
  const fresh = new Map<string, TrendItem & { sortMs: number }>()
  for (const id of allIds) {
    const aaGroup = aaIds.has(id) ? devGroups.get(id) : undefined
    const orGroup = orIds.has(id) ? orGroups.get(id) : undefined
    let metadata = aaGroup ?? orGroup
    if (metadata === undefined) continue
    if (aaGroup === undefined && orGroup !== undefined) {
      const matched = matchCanonical(orGroup[0]!, devGroups, index)
      if (matched !== null) metadata = devGroups.get(matched) ?? orGroup
    }
    const badges: ('aa' | 'openrouter')[] = []
    if (aaIds.has(id)) badges.push('aa')
    if (orIds.has(id)) badges.push('openrouter')
    const aaMs = aaGroup?.reduce((max, record) => Math.max(max, record.releasePrecision === 'day' ? record.releaseMs ?? 0 : 0), 0) ?? 0
    const orMs = orGroup?.reduce((max, record) => Math.max(max, record.releaseMs ?? 0), 0) ?? 0
    fresh.set(id, makeItem({ metadata, badges, aaMs, orMs }))
  }

  const merged = new Map<string, TrendItem & { sortMs?: number }>(fresh)
  if (input.modelsDev === null) {
    for (const item of carriedItems(input.previous, 'aa', nowMs)) {
      const existing = merged.get(item.id)
      if (existing === undefined) merged.set(item.id, item)
      else merged.set(item.id, { ...existing, registeredIn: unionBadges(existing.registeredIn, 'aa') })
    }
  }
  if (input.openrouter === null) {
    for (const item of carriedItems(input.previous, 'openrouter', nowMs)) {
      const existing = merged.get(item.id)
      if (existing === undefined) merged.set(item.id, item)
      else merged.set(item.id, { ...existing, registeredIn: unionBadges(existing.registeredIn, 'openrouter') })
    }
  }

  const items = [...merged.values()]
    .sort((a, b) => (b.sortMs ?? 0) - (a.sortMs ?? 0) || a.name.localeCompare(b.name))
    .slice(0, MAX_ITEMS)
    .map(({ sortMs: _sortMs, ...item }) => item)

  return {
    section: 'new-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: new Date(nowMs).toISOString(),
    rule: TREND_NEW_MODELS_RULE,
    sources: [...input.sources],
    items,
  }
}
