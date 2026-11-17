import {
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
} from '../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload, TrendSourceState } from '../../../shared/trend-contract'
import { buildFreeModels } from '../../domain/trend/sections/free-models'
import { buildNewModels } from '../../domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource, TrendSourceFailure, TrendSourceFetchResult } from '../../domain/trend/sources'
import type { TrendSourceStateRow, TrendStore } from '../../domain/trend/store'

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

function sourceState(
  entry: FetchedSource | undefined,
  previous: TrendSectionPayload | null,
  nowIso: string,
): TrendSourceState | null {
  if (entry === undefined) return null
  const status = entry.fetched.ok ? 'ok' : 'stale'
  return {
    id: entry.source.id,
    fetchedAt: status === 'ok'
      ? nowIso
      : previous?.sources.find((source) => source.id === entry.source.id)?.fetchedAt ?? nowIso,
    status,
  }
}

async function applyNewModels(
  store: TrendStore,
  modelsDev: FetchedSource | undefined,
  openrouter: FetchedSource | undefined,
  nowMs: number,
): Promise<TrendRefreshResult> {
  const row = await store.readSection('new-models')
  const previous = row === null ? null : parseSectionPayload<TrendSectionPayload>(row.payload, 'new-models')
  const nowIso = new Date(nowMs).toISOString()
  const sources = [sourceState(modelsDev, previous, nowIso), sourceState(openrouter, previous, nowIso)]
    .filter((source): source is TrendSourceState => source !== null)
  const modelsDevRecords = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  const openrouterRecords = openrouter !== undefined && isFresh(openrouter.fetched) ? openrouter.fetched.models ?? [] : null
  // 첫 실행부터 두 출처가 모두 실패하면 빈 섹션을 만들지 않는다.
  if (modelsDevRecords === null && openrouterRecords === null && previous === null) {
    return { ok: false, reason: 'source_failed' }
  }
  const payload = buildNewModels({ modelsDev: modelsDevRecords, openrouter: openrouterRecords, previous, sources, nowMs })
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  return { ok: true, skipped: false, written: !unchanged, count: payload.items.length }
}

async function applyFreeModels(
  store: TrendStore,
  modelsDev: FetchedSource | undefined,
  nowMs: number,
): Promise<TrendSectionOutcome> {
  const row = await store.readSection('free-models')
  const previous = row === null ? null : parseSectionPayload<TrendSectionPayload>(row.payload, 'free-models')
  const observations = store.readPlanObservations === undefined ? [] : await store.readPlanObservations()
  if (observations.length === 0 && previous === null) {
    return { ok: false, written: false, count: 0, stale: true }
  }
  const catalog = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  const payload = buildFreeModels({ observations, catalog, previous, nowMs })
  const stale = payload.sources.some((source) => source.status === 'stale')
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  return { ok: !stale, written: !unchanged, count: payload.items.length, stale }
}

/** cron 경로: 출처별로 격리해 new-models와 free-models를 함께 갱신한다. */
export async function refreshTrendSections(input: {
  store: TrendStore
  sources: readonly TrendSource[]
  nowMs: number
}): Promise<TrendRefreshAllResult> {
  const fetched = await Promise.all(input.sources.map((source) => fetchSource(input.store, source, input.nowMs)))
  const modelsDev = fetched.find((entry) => entry.source.id === TREND_SOURCE_MODELS_DEV)
  const openrouter = fetched.find((entry) => entry.source.id === TREND_SOURCE_OPENROUTER)
  const newModels = await applyNewModels(input.store, modelsDev, openrouter, input.nowMs)
  const freeModels = await applyFreeModels(input.store, modelsDev, input.nowMs)
  const sources: Record<string, 'ok' | 'stale'> = {}
  for (const entry of fetched) sources[entry.source.id] = entry.fetched.ok ? 'ok' : 'stale'
  const catalog = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  return { newModels, freeModels, sources, catalog }
}
