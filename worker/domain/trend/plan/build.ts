import {
  TREND_PLAN_MODELS_RULE,
  TREND_PLAN_WINDOW_MS,
  TREND_SCHEMA_VERSION,
} from '../../../../shared/trend-contract'
import type {
  TrendPlanConfidence,
  TrendPlanGroup,
  TrendPlanItem,
  TrendPlanNote,
  TrendSourceState,
} from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import type { PlanObservation, PlanObservationRow, PlanSectionPayload } from './types'

interface PlanDefinition {
  id: string
  sourceId?: string
  alwaysUnavailable?: boolean
}

/** 화면에 노출하는 요금제 순서. 4c(Codex 문서 diff)는 아직 미구현이다. */
const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  { id: 'opencode-go', sourceId: 'go-models' },
  { id: 'ollama-cloud', sourceId: 'ollama-tags' },
  { id: 'antigravity' },
  { id: 'claude-max' },
  { id: 'grok' },
  { id: 'codex', alwaysUnavailable: true },
]

const CONFIDENCE_RANK: Record<TrendPlanConfidence, number> = { account: 4, catalog: 3, doc: 2, partial: 1 }
const RAW_ID_SEPARATOR = '\u0000'

export function normalizePlanName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

interface CatalogIndex {
  canonical: Map<string, TrendModelRecord>
  name: Map<string, TrendModelRecord>
  modelId: Map<string, TrendModelRecord>
}

function preferred(current: TrendModelRecord | undefined, candidate: TrendModelRecord): TrendModelRecord {
  if (current === undefined) return candidate
  if (current.releasePrecision !== 'day' && candidate.releasePrecision === 'day') return candidate
  if (current.releasePrecision === 'day' && candidate.releasePrecision !== 'day') return current
  return (candidate.releaseMs ?? 0) > (current.releaseMs ?? 0) ? candidate : current
}

function addCatalog(map: Map<string, TrendModelRecord>, key: string, record: TrendModelRecord): void {
  if (key === '') return
  map.set(key, preferred(map.get(key), record))
}

function buildCatalogIndex(records: readonly TrendModelRecord[] | null): CatalogIndex {
  const index: CatalogIndex = { canonical: new Map(), name: new Map(), modelId: new Map() }
  for (const record of records ?? []) {
    addCatalog(index.canonical, record.canonicalId, record)
    addCatalog(index.name, normalizePlanName(record.name), record)
    addCatalog(index.modelId, normalizePlanName(record.modelId), record)
  }
  return index
}

function matchRecord(observation: PlanObservation, index: CatalogIndex): TrendModelRecord | null {
  const canonical = index.canonical.get(observation.modelId)
  if (canonical !== undefined) return canonical
  if (observation.displayName !== null) {
    const byName = index.name.get(normalizePlanName(observation.displayName))
    if (byName !== undefined) return byName
  }
  return index.modelId.get(normalizePlanName(observation.modelId)) ?? null
}

interface PreviousIndex {
  byRawId: Map<string, TrendPlanItem>
}

function buildPreviousIndex(previous: PlanSectionPayload | null): PreviousIndex {
  const byRawId = new Map<string, TrendPlanItem>()
  for (const group of previous?.plans ?? []) {
    for (const item of group.items) {
      const rawIds = typeof item.extra?.rawIds === 'string' ? item.extra.rawIds.split(RAW_ID_SEPARATOR) : [item.id]
      for (const rawId of rawIds) byRawId.set(`${group.id}:${rawId}`, item)
    }
  }
  return { byRawId }
}

function rawIdsOf(item: TrendPlanItem): string[] {
  return typeof item.extra?.rawIds === 'string' ? item.extra.rawIds.split(RAW_ID_SEPARATOR) : [item.id]
}

function makeItem(
  observation: PlanObservation,
  firstSeenAtMs: number,
  planId: string,
  index: CatalogIndex,
  previous: PreviousIndex,
): TrendPlanItem {
  const firstSeenAt = new Date(firstSeenAtMs).toISOString()
  const record = matchRecord(observation, index)
  if (record !== null) {
    return {
      id: record.canonicalId,
      name: record.name,
      creator: record.creator,
      releaseDate: record.releaseDate,
      precision: record.releasePrecision,
      firstSeenAt,
      confidence: observation.confidence,
      source: observation.source,
      matched: true,
      extra: { rawIds: observation.modelId },
    }
  }
  const fallback = previous.byRawId.get(`${planId}:${observation.modelId}`)
  if (fallback !== undefined) {
    return {
      ...fallback,
      firstSeenAt,
      confidence: observation.confidence,
      source: observation.source,
      extra: { ...fallback.extra, rawIds: observation.modelId },
    }
  }
  return {
    id: observation.modelId,
    name: observation.displayName ?? observation.modelId,
    creator: null,
    releaseDate: null,
    precision: 'unknown',
    firstSeenAt,
    confidence: observation.confidence,
    source: observation.source,
    matched: false,
    extra: { rawIds: observation.modelId },
  }
}

function mergeItems(existing: TrendPlanItem, next: TrendPlanItem): TrendPlanItem {
  const confidence = CONFIDENCE_RANK[next.confidence] > CONFIDENCE_RANK[existing.confidence] ? next.confidence : existing.confidence
  const source = CONFIDENCE_RANK[next.confidence] > CONFIDENCE_RANK[existing.confidence] ? next.source : existing.source
  const metadata = next.matched && !existing.matched ? next : existing
  const rawIds = [...new Set([...rawIdsOf(existing), ...rawIdsOf(next)])]
  return {
    ...metadata,
    id: existing.id,
    firstSeenAt: Date.parse(next.firstSeenAt) < Date.parse(existing.firstSeenAt) ? next.firstSeenAt : existing.firstSeenAt,
    confidence,
    source,
    matched: existing.matched || next.matched,
    extra: { ...metadata.extra, rawIds: rawIds.join(RAW_ID_SEPARATOR) },
  }
}

function buildGroup(
  definition: PlanDefinition,
  observations: readonly PlanObservationRow[],
  index: CatalogIndex,
  previous: PreviousIndex,
  sources: readonly TrendSourceState[],
  nowMs: number,
): TrendPlanGroup | null {
  const windowStart = nowMs - TREND_PLAN_WINDOW_MS
  const byId = new Map<string, TrendPlanItem>()
  for (const observation of observations) {
    if (observation.plan !== definition.id) continue
    if (observation.baseline) continue
    if (observation.firstSeenAt < windowStart || observation.firstSeenAt > nowMs) continue
    const item = makeItem(observation, observation.firstSeenAt, definition.id, index, previous)
    const existing = byId.get(item.id)
    byId.set(item.id, existing === undefined ? item : mergeItems(existing, item))
  }
  const items = [...byId.values()].sort((a, b) => Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) || a.name.localeCompare(b.name))

  if (definition.alwaysUnavailable === true) {
    return { id: definition.id, status: 'unavailable', items: [], note: 'not_implemented' }
  }
  const sourceStale = definition.sourceId !== undefined && sources.find((source) => source.id === definition.sourceId)?.status === 'stale'
  if (items.length === 0) {
    if (definition.id === 'grok') return { id: definition.id, status: 'unavailable', items: [], note: 'unverified' }
    if (sourceStale) return { id: definition.id, status: 'unavailable', items: [], note: 'source_failed' }
    return null
  }
  const partial = items.some((item) => item.confidence === 'partial')
  const note: TrendPlanNote | undefined = sourceStale ? 'source_failed' : partial ? 'partial_judgement' : undefined
  return {
    id: definition.id,
    status: sourceStale || partial ? 'partial' : 'ok',
    items,
    ...(note === undefined ? {} : { note }),
  }
}

/** 요금제별 관측을 최근 14일·baseline 제외 규칙으로 묶고 models.dev 메타를 보강한다. */
export function buildPlanModels(input: {
  observations: readonly PlanObservationRow[]
  catalog: readonly TrendModelRecord[] | null
  sources: readonly TrendSourceState[]
  previous: PlanSectionPayload | null
  nowMs: number
}): PlanSectionPayload {
  const index = buildCatalogIndex(input.catalog)
  const previous = buildPreviousIndex(input.previous)
  const plans: TrendPlanGroup[] = []
  for (const definition of PLAN_DEFINITIONS) {
    const group = buildGroup(definition, input.observations, index, previous, input.sources, input.nowMs)
    if (group !== null) plans.push(group)
  }
  return {
    section: 'plan-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: new Date(input.nowMs).toISOString(),
    rule: TREND_PLAN_MODELS_RULE,
    sources: [...input.sources],
    items: [],
    plans,
  }
}
