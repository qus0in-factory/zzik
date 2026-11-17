/**
 * `free-models` 섹션: OpenCode Go·Ollama Cloud 요금제에 포함되어 추가 비용 없이 쓸 수 있는 모델.
 * 관측 로그(trend_plan_observation)의 현재 목록을 두 그룹으로 보여 주고 models.dev로 메타를 보강한다.
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_FREE_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
} from '../../../../shared/trend-contract'
import type { TrendFreeKind, TrendItem, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import { normalizePlanName } from '../plan/build'
import type { PlanObservationRow } from '../plan/types'

const MAX_ITEMS = 50
const PLAN_GROUPS: ReadonlyArray<{ id: TrendFreeKind; sourceId: string }> = [
  { id: 'opencode-go', sourceId: 'go-models' },
  { id: 'ollama-cloud', sourceId: 'ollama-tags' },
]
const SOURCE_FRESH_MS = 12 * 3_600_000

export interface FreeModelsInput {
  observations: readonly PlanObservationRow[]
  catalog: readonly TrendModelRecord[] | null
  previous: TrendSectionPayload | null
  nowMs: number
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

interface CatalogIndex {
  canonical: Map<string, TrendModelRecord[]>
  byName: Map<string, string>
  byModelId: Map<string, string>
}

function buildCatalogIndex(records: readonly TrendModelRecord[] | null): CatalogIndex {
  const canonical = new Map<string, TrendModelRecord[]>()
  const byName = new Map<string, string>()
  const byModelId = new Map<string, string>()
  for (const record of records ?? []) {
    const group = canonical.get(record.canonicalId)
    if (group === undefined) canonical.set(record.canonicalId, [record])
    else group.push(record)
    if (!byName.has(normalizePlanName(record.name))) byName.set(normalizePlanName(record.name), record.canonicalId)
    if (!byModelId.has(normalizePlanName(record.modelId))) byModelId.set(normalizePlanName(record.modelId), record.canonicalId)
  }
  return { canonical, byName, byModelId }
}

function matchMetadata(observation: PlanObservationRow, index: CatalogIndex): TrendModelRecord[] | null {
  if (index.canonical.has(observation.modelId)) return index.canonical.get(observation.modelId) ?? null
  if (observation.displayName !== null) {
    const byName = index.byName.get(normalizePlanName(observation.displayName))
    if (byName !== undefined) return index.canonical.get(byName) ?? null
  }
  const byModelId = index.byModelId.get(normalizePlanName(observation.modelId))
  return byModelId === undefined ? null : index.canonical.get(byModelId) ?? null
}

function itemFromObservation(observation: PlanObservationRow, plan: TrendFreeKind, index: CatalogIndex): TrendItem {
  const metadata = matchMetadata(observation, index)
  if (metadata !== null) {
    const chosen = representative(metadata)
    const release = pickRelease(metadata)
    return {
      id: chosen.canonicalId,
      name: chosen.name,
      creator: chosen.creator,
      releaseDate: release.releaseDate,
      precision: release.precision,
      price: { input: 0, output: 0 },
      free: true,
      openWeights: metadata.some((record) => record.openWeights),
      providers: [plan],
      links: {},
      freeKind: plan,
    }
  }
  return {
    id: observation.modelId,
    name: observation.displayName ?? observation.modelId,
    creator: '',
    releaseDate: null,
    precision: 'unknown',
    price: { input: 0, output: 0 },
    free: true,
    openWeights: false,
    providers: [plan],
    links: {},
    freeKind: plan,
  }
}

function mergePlanItems(items: readonly TrendItem[]): TrendItem[] {
  const merged = new Map<string, TrendItem>()
  for (const item of items) {
    const existing = merged.get(item.id)
    if (existing === undefined) {
      merged.set(item.id, item)
      continue
    }
    merged.set(item.id, { ...existing, openWeights: existing.openWeights || item.openWeights })
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function previousItems(previous: TrendSectionPayload | null, group: TrendFreeKind): TrendItem[] {
  return previous?.items.filter((item) => item.freeKind === group) ?? []
}

/** 관측 로그의 최근 목록을 두 요금제 그룹으로 묶는다. source가 멈추면 마지막 공개 항목을 유지한다. */
export function buildFreeModels(input: FreeModelsInput): TrendSectionPayload {
  const { nowMs } = input
  const index = buildCatalogIndex(input.catalog)
  const items: TrendItem[] = []
  const sources: TrendSourceState[] = []

  for (const group of PLAN_GROUPS) {
    const observations = input.observations.filter((observation) =>
      observation.plan === group.id && observation.lastSeenAt >= nowMs - TREND_FREE_MODELS_WINDOW_MS)
    const freshItems = mergePlanItems(observations.map((observation) => itemFromObservation(observation, group.id, index)))
    const carried = freshItems.length > 0 ? freshItems : previousItems(input.previous, group.id)
    items.push(...carried.slice(0, MAX_ITEMS))

    const lastSeen = observations.reduce((max, observation) => Math.max(max, observation.lastSeenAt), 0)
    const previousSource = input.previous?.sources.find((source) => source.id === group.sourceId)
    const fresh = lastSeen > 0 && lastSeen >= nowMs - SOURCE_FRESH_MS
    const fetchedAt = lastSeen > 0 ? new Date(lastSeen).toISOString() : previousSource?.fetchedAt ?? new Date(nowMs).toISOString()
    sources.push({
      id: group.sourceId,
      fetchedAt,
      status: fresh ? 'ok' : 'stale',
    })
  }

  return {
    section: 'free-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: new Date(nowMs).toISOString(),
    rule: TREND_FREE_MODELS_RULE,
    sources,
    items: items.slice(0, MAX_ITEMS),
  }
}
