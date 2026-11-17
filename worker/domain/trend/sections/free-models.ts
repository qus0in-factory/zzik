/**
 * `free-models` 섹션: OpenCode Zen(`/zen/v1/models`)에서 입력·출력 가격 0으로 제공되는 무료 모델.
 * Ollama Cloud는 무료 티어가 없으므로 제외하고, models.dev로 메타데이터를 보강한다.
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_FREE_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_OPENCODE_ZEN,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import { normalizePlanName } from '../plan/build'

const MAX_ITEMS = 50

export interface FreeModelsInput {
  zen: readonly TrendModelRecord[] | null
  catalog: readonly TrendModelRecord[] | null
  previous: TrendSectionPayload | null
  sources: readonly TrendSourceState[]
  nowMs: number
}

interface CatalogIndex {
  canonical: Map<string, TrendModelRecord>
  byModelId: Map<string, TrendModelRecord>
  byName: Map<string, TrendModelRecord>
}

function buildCatalogIndex(records: readonly TrendModelRecord[] | null): CatalogIndex {
  const canonical = new Map<string, TrendModelRecord>()
  const byModelId = new Map<string, TrendModelRecord>()
  const byName = new Map<string, TrendModelRecord>()
  for (const record of records ?? []) {
    if (!canonical.has(record.canonicalId)) canonical.set(record.canonicalId, record)
    const modelKey = normalizePlanName(record.modelId)
    if (!byModelId.has(modelKey)) byModelId.set(modelKey, record)
    const nameKey = normalizePlanName(record.name)
    if (!byName.has(nameKey)) byName.set(nameKey, record)
  }
  return { canonical, byModelId, byName }
}

function matchCatalog(record: TrendModelRecord, index: CatalogIndex): TrendModelRecord | null {
  return (
    index.canonical.get(record.canonicalId) ??
    index.byModelId.get(normalizePlanName(record.modelId)) ??
    index.byName.get(normalizePlanName(record.name)) ??
    null
  )
}

function itemFromZen(record: TrendModelRecord, index: CatalogIndex, nowMs: number): TrendItem {
  const matched = matchCatalog(record, index)
  const releaseDate = record.releaseDate ?? matched?.releaseDate ?? null
  const precision = record.releaseDate !== null ? record.releasePrecision : matched?.releasePrecision ?? 'unknown'
  const releaseMs = record.releaseMs ?? matched?.releaseMs ?? null
  const creator = record.creator !== '' ? record.creator : matched?.creator ?? ''
  const recentlyAdded = releaseMs !== null && releaseMs >= nowMs - TREND_FREE_MODELS_WINDOW_MS
  return {
    id: record.canonicalId,
    name: record.name,
    creator,
    releaseDate,
    precision,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: record.openWeights || (matched?.openWeights ?? false),
    providers: [TREND_SOURCE_OPENCODE_ZEN],
    links: {},
    freeKind: 'opencode-zen',
    recentlyAdded,
  }
}

function dedupeItems(items: readonly TrendItem[]): TrendItem[] {
  const map = new Map<string, TrendItem>()
  for (const item of items) {
    const existing = map.get(item.id)
    if (existing === undefined) {
      map.set(item.id, item)
      continue
    }
    map.set(item.id, {
      ...existing,
      openWeights: existing.openWeights || item.openWeights,
      recentlyAdded: Boolean(existing.recentlyAdded || item.recentlyAdded),
    })
  }
  return [...map.values()].sort((a, b) => {
    const recentDiff = Number(Boolean(b.recentlyAdded)) - Number(Boolean(a.recentlyAdded))
    return recentDiff !== 0 ? recentDiff : a.name.localeCompare(b.name)
  })
}

/** OpenCode Zen 무료 모델 전체를 반환하며 최근 30일 이내 모델에 `recentlyAdded`를 표시한다. */
export function buildFreeModels(input: FreeModelsInput): TrendSectionPayload {
  const index = buildCatalogIndex(input.catalog)
  const items = input.zen === null
    ? [...(input.previous?.items ?? [])]
    : dedupeItems(
        input.zen
          .filter((record) => record.free && record.status !== 'deprecated')
          .map((record) => itemFromZen(record, index, input.nowMs)),
      )

  return {
    section: 'free-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: new Date(input.nowMs).toISOString(),
    rule: TREND_FREE_MODELS_RULE,
    sources: [...input.sources],
    items: items.slice(0, MAX_ITEMS),
  }
}
