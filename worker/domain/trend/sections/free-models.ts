/**
 * `free-models` 섹션:
 * OpenCode Go(`/inference/go/v1/models`)에서 입력·출력 가격 0인 무료 항목(고정 `go#pricing` 링크, 기간/지역 한정 표시).
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_FREE_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_OPENCODE_GO,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import { normalizePlanName } from '../plan/build'
import { carryEnrichment } from './carry-metadata'

const MAX_ITEMS = 50

export interface FreeModelsInput {
  goModels: readonly TrendModelRecord[] | null
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

function itemFromGo(record: TrendModelRecord, index: CatalogIndex, nowMs: number): TrendItem {
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
    providers: [TREND_SOURCE_OPENCODE_GO],
    links: record.link ? { opencode: record.link } : {},
    freeKind: 'opencode-go',
    recentlyAdded,
    ...(record.limitedTime !== undefined ? { limitedTime: record.limitedTime } : {}),
    ...(record.limitedRegions !== undefined ? { limitedRegions: record.limitedRegions } : {}),
  }
}

function dedupeSorted(items: readonly TrendItem[]): TrendItem[] {
  const map = new Map<string, TrendItem>()
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, item)
  }
  return [...map.values()].sort((a, b) => {
    const recentDiff = Number(Boolean(b.recentlyAdded)) - Number(Boolean(a.recentlyAdded))
    return recentDiff !== 0 ? recentDiff : a.name.localeCompare(b.name)
  })
}

/** OpenCode Go 무료 행을 반환한다. 출처가 실패/304면 직전 값을 유지한다. */
export function buildFreeModels(input: FreeModelsInput): TrendSectionPayload {
  const index = buildCatalogIndex(input.catalog)
  const prevById = new Map((input.previous?.items ?? []).map((item) => [item.id, item]))
  const items = input.goModels === null
    ? [...(input.previous?.items ?? [])]
    : dedupeSorted(
        input.goModels
          .filter((record) => record.free && record.status !== 'deprecated')
          .map((record) => {
            const built = itemFromGo(record, index, input.nowMs)
            const carried = input.catalog === null ? carryEnrichment(built, prevById.get(built.id)) : built
            if (input.catalog !== null || carried.recentlyAdded || carried.releaseDate === null) return carried
            const parsed = Date.parse(carried.releaseDate)
            return Number.isNaN(parsed)
              ? carried
              : { ...carried, recentlyAdded: parsed >= input.nowMs - TREND_FREE_MODELS_WINDOW_MS }
          }),
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
