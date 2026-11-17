/**
 * `free-models` 섹션:
 * 1) OpenCode Go 무료: `/inference/go/v1/models`에서 입력·출력 가격 0인 행(고정 `go#pricing` 링크, 기간/지역 한정 표시).
 * 2) Ollama Cloud 무료: Ollama 블로그 RSS(`/blog/rss.xml`)의 최근 90일 기간 한정 무료 공지.
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_FREE_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_OLLAMA_BLOG,
  TREND_SOURCE_OPENCODE_GO,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'
import { normalizePlanName } from '../plan/build'

const MAX_ITEMS = 50
const OLLAMA_PROMO_WINDOW_MS = 90 * 86_400_000

export interface FreeModelsInput {
  goModels: readonly TrendModelRecord[] | null
  ollamaBlog: readonly TrendModelRecord[] | null
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

function itemFromOllamaBlog(record: TrendModelRecord, nowMs: number): TrendItem {
  const recentlyAdded = record.releaseMs !== null && record.releaseMs >= nowMs - TREND_FREE_MODELS_WINDOW_MS
  return {
    id: record.canonicalId,
    name: record.name,
    creator: record.creator,
    releaseDate: record.releaseDate,
    precision: record.releasePrecision,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: record.openWeights,
    providers: [TREND_SOURCE_OLLAMA_BLOG],
    links: record.link ? { ollama: record.link } : {},
    freeKind: 'ollama-cloud',
    recentlyAdded,
    limitedTime: true,
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

/** OpenCode Go 무료 행과 Ollama 블로그 기간 한정 무료 공지를 반환한다. 실패한 그룹은 직전 값을 유지한다. */
export function buildFreeModels(input: FreeModelsInput): TrendSectionPayload {
  const index = buildCatalogIndex(input.catalog)
  const previousGo = input.previous?.items.filter((item) => item.freeKind === 'opencode-go') ?? []
  const previousOllama = input.previous?.items.filter((item) => item.freeKind === 'ollama-cloud') ?? []

  const goItems = input.goModels === null
    ? previousGo
    : dedupeSorted(
        input.goModels
          .filter((record) => record.free && record.status !== 'deprecated')
          .map((record) => itemFromGo(record, index, input.nowMs)),
      )

  const ollamaItems = input.ollamaBlog === null
    ? previousOllama
    : dedupeSorted(
        input.ollamaBlog
          .filter((record) => record.releaseMs === null || record.releaseMs >= input.nowMs - OLLAMA_PROMO_WINDOW_MS)
          .map((record) => itemFromOllamaBlog(record, input.nowMs)),
      )

  return {
    section: 'free-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: new Date(input.nowMs).toISOString(),
    rule: TREND_FREE_MODELS_RULE,
    sources: [...input.sources],
    items: [...goItems, ...ollamaItems].slice(0, MAX_ITEMS),
  }
}
