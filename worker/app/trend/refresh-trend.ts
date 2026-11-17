import {
  TREND_FREE_MODELS_RULE,
  TREND_NEW_MODELS_RULE,
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
} from '../../../shared/trend-contract'
import type { TrendFreeKind, TrendItem, TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import { buildFreeModels } from '../../domain/trend/sections/free-models'
import type { FreeModelsPayload, FreeModelsSourceData } from '../../domain/trend/sections/free-models'
import { buildNewModels, reevaluateNewModels } from '../../domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource, TrendSourceFailure, TrendSourceFetchResult } from '../../domain/trend/sources'
import type { TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../domain/trend/store'

export type TrendRefreshResult =
  | { ok: true; skipped: boolean; written: boolean; count: number }
  | { ok: false; reason: 'source_failed' }

export interface TrendSectionOutcome {
  ok: boolean
  written: boolean
  count: number
  stale: boolean
}

export interface TrendRefreshAllResult {
  newModels: TrendRefreshResult
  freeModels: TrendSectionOutcome
  sources: Record<string, 'ok' | 'stale'>
  /** models.dev 200일 때 plan-models 메타 매칭에 재사용한다. 304·실패면 null. */
  catalog: readonly TrendModelRecord[] | null
}

interface FetchedSource {
  source: TrendSource
  fetched: TrendSourceFetchResult | TrendSourceFailure
}

function parseSectionPayload<T extends TrendSectionPayload>(text: string, section: TrendSection): T | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as T
    if (payload.section !== section || !Array.isArray(payload.items) || !Array.isArray(payload.sources)) return null
    return payload
  } catch {
    return null
  }
}

function sameContent(existing: TrendSectionPayload, next: TrendSectionPayload): boolean {
  return existing.schemaVersion === next.schemaVersion &&
    existing.rule === next.rule &&
    JSON.stringify(existing.items) === JSON.stringify(next.items) &&
    JSON.stringify(existing.sources.map((source) => [source.id, source.status])) === JSON.stringify(next.sources.map((source) => [source.id, source.status]))
}

function withSourceStatus(payload: TrendSectionPayload, status: 'ok' | 'stale', fetchedAt: string): TrendSectionPayload {
  return {
    ...payload,
    sources: payload.sources.map((source) => source.id === TREND_SOURCE_MODELS_DEV ? { ...source, status, fetchedAt } : source),
  }
}

async function markStale(store: TrendStore, nowMs: number): Promise<void> {
  const row = await store.readSection('new-models')
  if (row === null) return
  const payload = parseSectionPayload<TrendSectionPayload>(row.payload, 'new-models')
  if (payload === null) return
  const source = payload.sources.find((item) => item.id === TREND_SOURCE_MODELS_DEV)
  if (source === undefined || source.status === 'stale') return
  await store.writeSection(withSourceStatus(payload, 'stale', new Date(nowMs).toISOString()))
}

function newSeenRows(records: readonly TrendModelRecord[], seen: ReadonlyMap<string, number>, nowMs: number): TrendSeenRow[] {
  const releaseStart = nowMs - 30 * 86_400_000
  const rows = new Map<string, TrendSeenRow>()
  for (const record of records) {
    if (record.releaseMs === null || record.releaseMs < releaseStart || record.releaseMs > nowMs) continue
    if (seen.has(record.canonicalId) || rows.has(record.canonicalId)) continue
    rows.set(record.canonicalId, { canonicalId: record.canonicalId, firstSeenAt: nowMs, releaseDate: record.releaseDate, source: TREND_SOURCE_MODELS_DEV })
  }
  return [...rows.values()]
}

function isFresh(fetched: TrendSourceFetchResult | TrendSourceFailure): fetched is TrendSourceFetchResult {
  return fetched.ok && !fetched.notModified
}

async function fetchOnce(store: TrendStore, source: TrendSource, etag: string | null, nowMs: number): Promise<FetchedSource> {
  const fetched = await source.fetch(etag)
  if (!fetched.ok) {
    await store.writeSourceState({
      source: source.id,
      etag,
      fetchedAt: nowMs,
      ok: false,
      httpStatus: fetched.httpStatus,
    })
  } else if (fetched.notModified) {
    await store.writeSourceState({
      source: source.id,
      etag: fetched.etag ?? etag,
      fetchedAt: nowMs,
      ok: true,
      httpStatus: 304,
    })
  } else {
    await store.writeSourceState({
      source: source.id,
      etag: fetched.etag,
      fetchedAt: nowMs,
      ok: true,
      httpStatus: 200,
    })
  }
  return { source, fetched }
}

async function fetchSource(store: TrendStore, source: TrendSource, nowMs: number): Promise<FetchedSource> {
  const state = await store.readSourceState(source.id)
  return fetchOnce(store, source, state?.etag ?? null, nowMs)
}

async function applyFresh(
  store: TrendStore,
  fetched: TrendSourceFetchResult,
  nowMs: number,
): Promise<TrendRefreshResult> {
  const models = fetched.models ?? []
  const seenRows = await store.readSeen()
  const seen = new Map(seenRows.map((row) => [row.canonicalId, row.firstSeenAt]))
  const payload = buildNewModels(models, seen, nowMs)
  const existing = await store.readSection('new-models')
  const previous = existing === null ? null : parseSectionPayload<TrendSectionPayload>(existing.payload, 'new-models')
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  await store.upsertSeen(newSeenRows(models, seen, nowMs))
  return { ok: true, skipped: false, written: !unchanged, count: payload.items.length }
}

async function applyNewModels(store: TrendStore, fetchedSource: FetchedSource, nowMs: number): Promise<TrendRefreshResult> {
  const { fetched, source } = fetchedSource
  if (!fetched.ok) {
    await markStale(store, nowMs)
    return { ok: false, reason: 'source_failed' }
  }
  if (fetched.notModified) {
    const row = await store.readSection('new-models')
    if (row === null) return { ok: true, skipped: true, written: false, count: 0 }
    const payload = parseSectionPayload<TrendSectionPayload>(row.payload, 'new-models')
    if (payload === null) return { ok: true, skipped: true, written: false, count: 0 }
    // 304는 출처 상태를 회복시키고, 저장된 firstSeenAt/releaseMs로 7일 창을 다시 적용한다.
    const recovered = withSourceStatus(payload, 'ok', new Date(nowMs).toISOString())
    const reevaluated = reevaluateNewModels(recovered, nowMs)
    if (reevaluated === null) {
      // 이전 스키마(정규화 메타데이터 없음)면 조건 없이 한 번 더 받아 재구성한다.
      const refreshed = await fetchOnce(store, source, null, nowMs)
      if (!isFresh(refreshed.fetched)) return { ok: true, skipped: true, written: false, count: 0 }
      return applyFresh(store, refreshed.fetched, nowMs)
    }
    if (sameContent(payload, reevaluated)) return { ok: true, skipped: true, written: false, count: reevaluated.items.length }
    await store.writeSection(reevaluated)
    return { ok: true, skipped: false, written: true, count: reevaluated.items.length }
  }
  return applyFresh(store, fetched, nowMs)
}

const SOURCE_KIND: Record<string, TrendFreeKind> = {
  [TREND_SOURCE_MODELS_DEV]: 'local',
  [TREND_SOURCE_OPENCODE_ZEN]: 'hosted',
  [TREND_SOURCE_OPENROUTER]: 'hosted',
}

function previousSourceItems(previous: FreeModelsPayload | null, sourceId: string): readonly TrendItem[] {
  return previous?.sourceItems?.[sourceId] ?? []
}

async function applyFreeModels(store: TrendStore, fetchedSources: readonly FetchedSource[], nowMs: number): Promise<TrendSectionOutcome> {
  const row = await store.readSection('free-models')
  const previous = row === null ? null : parseSectionPayload<FreeModelsPayload>(row.payload, 'free-models')
  const anySucceeded = fetchedSources.some((entry) => entry.fetched.ok)
  // 첫 수집부터 모든 출처가 실패하면 빈 섹션을 만들지 않는다(not_ready 유지).
  if (!anySucceeded && previous === null) return { ok: false, written: false, count: 0, stale: true }

  const nowIso = new Date(nowMs).toISOString()
  const sources: FreeModelsSourceData[] = fetchedSources.map((entry) => {
    const kind = SOURCE_KIND[entry.source.id] ?? 'hosted'
    const carried = previousSourceItems(previous, entry.source.id)
    const previousSource = previous?.sources.find((source) => source.id === entry.source.id)
    if (isFresh(entry.fetched)) {
      return { id: entry.source.id, kind, status: 'ok', fetchedAt: nowIso, records: entry.fetched.models ?? [], carried }
    }
    const ok = entry.fetched.ok // 304는 성공, 실패는 stale
    return {
      id: entry.source.id,
      kind,
      status: ok ? 'ok' : 'stale',
      fetchedAt: ok ? nowIso : previousSource?.fetchedAt ?? nowIso,
      records: null,
      carried,
    }
  })

  const payload = buildFreeModels(sources, nowMs)
  const stale = payload.sources.some((source) => source.status === 'stale')
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  return { ok: !stale, written: !unchanged, count: payload.items.length, stale }
}

/** models.dev 한 출처로 new-models만 갱신한다(기존 단일 섹션 경로). */
export async function refreshTrend(input: { store: TrendStore; source: TrendSource; nowMs: number }): Promise<TrendRefreshResult> {
  const fetched = await fetchSource(input.store, input.source, input.nowMs)
  return applyNewModels(input.store, fetched, input.nowMs)
}

/** cron 경로: 출처별로 격리해 new-models와 free-models를 함께 갱신한다. */
export async function refreshTrendSections(input: {
  store: TrendStore
  sources: readonly TrendSource[]
  nowMs: number
}): Promise<TrendRefreshAllResult> {
  const fetched = await Promise.all(input.sources.map((source) => fetchSource(input.store, source, input.nowMs)))
  const modelsDev = fetched.find((entry) => entry.source.id === TREND_SOURCE_MODELS_DEV)
  const newModels: TrendRefreshResult = modelsDev === undefined
    ? { ok: true, skipped: true, written: false, count: 0 }
    : await applyNewModels(input.store, modelsDev, input.nowMs)
  const freeModels = await applyFreeModels(input.store, fetched, input.nowMs)
  const sources: Record<string, 'ok' | 'stale'> = {}
  for (const entry of fetched) sources[entry.source.id] = entry.fetched.ok ? 'ok' : 'stale'
  const catalog = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  return { newModels, freeModels, sources, catalog }
}

export { TREND_FREE_MODELS_RULE, TREND_NEW_MODELS_RULE }
