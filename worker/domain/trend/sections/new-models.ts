/**
 * `new-models` 섹션: 최근 7일 안에 OpenRouter에 새로 등록된 모델.
 * OpenRouter `/models`의 `created`를 등록 시각으로 쓰고, models.dev는 이름·제작사·가격 등
 * 메타 보강에만 쓴다. Artificial Analysis 데이터는 공개 재배포가 불가해 사용하지 않는다.
 */
import {
  TREND_NEW_MODELS_RULE,
  TREND_NEW_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendPrice, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import { carryEnrichment } from './carry-metadata'

const MAX_ITEMS = 50
const DEPRECATED = new Set(['deprecated', 'retired'])

export interface NewModelsInput {
  /** models.dev 200 응답. 메타 보강용이며 304·실패면 null이다. */
  modelsDev: readonly TrendModelRecord[] | null
  /** OpenRouter 200 응답. 304·실패면 null이고 이전 OpenRouter 항목을 재사용한다. */
  openrouter: readonly TrendModelRecord[] | null
  previous: TrendSectionPayload | null
  sources: readonly TrendSourceState[]
  nowMs: number
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
    registeredIn: ['openrouter'],
    extra: { orMs: input.orMs },
    sortMs: input.orMs,
  }
}

function carriedItems(previous: TrendSectionPayload | null, nowMs: number): Array<TrendItem & { sortMs: number }> {
  if (previous === null) return []
  const items: Array<TrendItem & { sortMs: number }> = []
  for (const item of previous.items) {
    if (!Array.isArray(item.registeredIn) || !item.registeredIn.includes('openrouter')) continue
    const orMs = typeof item.extra?.orMs === 'number' ? item.extra.orMs : 0
    if (!inWindow(orMs, nowMs)) continue
    items.push({ ...item, registeredIn: ['openrouter'], extra: { ...item.extra, orMs }, sortMs: orMs })
  }
  return items
}

/** OpenRouter 등록 후보만 canonical id로 합치고 models.dev 메타로 보강한다. */
export function buildNewModels(input: NewModelsInput): TrendSectionPayload {
  const { nowMs } = input
  const devGroups = groupByCanonical(input.modelsDev ?? [])
  const index = catalogIndex(devGroups)
  const orGroups = groupByCanonical(input.openrouter ?? [])

  const prevById = new Map((input.previous?.items ?? []).map((item) => [item.id, item]))
  const fresh = new Map<string, TrendItem & { sortMs: number }>()
  if (input.openrouter !== null) {
    for (const [orId, group] of orGroups) {
      const createdMs = group.reduce((max, record) => Math.max(max, record.releaseMs ?? 0), 0)
      if (!inWindow(createdMs, nowMs)) continue
      const matched = matchCanonical(group[0]!, devGroups, index)
      const metadata = matched === null ? group : devGroups.get(matched) ?? group
      const item = makeItem({ metadata, orMs: createdMs })
      const enriched = input.modelsDev === null ? carryEnrichment(item, prevById.get(item.id)) : item
      fresh.set(enriched.id === '' ? orId : enriched.id, { ...enriched, sortMs: item.sortMs })
    }
  }

  const merged = new Map<string, TrendItem & { sortMs?: number }>(fresh)
  if (input.openrouter === null) {
    for (const item of carriedItems(input.previous, nowMs)) {
      if (!merged.has(item.id)) merged.set(item.id, item)
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
