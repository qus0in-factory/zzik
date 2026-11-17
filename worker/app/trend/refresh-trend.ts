import {
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_GO,
  TREND_SOURCE_OPENROUTER,
} from '../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload, TrendSourceState } from '../../../shared/trend-contract'
import { buildFreeModels } from '../../domain/trend/sections/free-models'
import { buildNewModels } from '../../domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource, TrendSourceFailure, TrendSourceFetchResult } from '../../domain/trend/sources'
import { sectionStateSourceId } from '../../domain/trend/store'
import type { TrendSourceStateRow, TrendStore } from '../../domain/trend/store'

export type TrendRefreshResult =
  | { ok: true; skipped: boolean; written: boolean; count: number; status?: 'written' | 'unchanged' }
  | { ok: false; reason: 'source_failed' | 'section_error'; status?: 'skipped' | 'error'; errorClass?: string }

export interface TrendSectionOutcome {
  ok: boolean
  written: boolean
  count: number
  stale: boolean
  status?: 'written' | 'unchanged' | 'skipped' | 'error'
  reason?: string
  errorClass?: string
}

export type SourceHttpSummary = '200' | '304' | 'fail'

export interface TrendRefreshAllResult {
  newModels: TrendRefreshResult
  freeModels: TrendSectionOutcome
  sources: Record<string, 'ok' | 'stale'>
  sourceStatuses: Record<string, SourceHttpSummary>
  /** models.dev 200일 때 plan-models 메타 매칭에 재사용한다. 304·실패면 null. */
  catalog: readonly TrendModelRecord[] | null
}

function safeErrorClass(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError'
  if (error instanceof RangeError) return 'RangeError'
  if (error instanceof SyntaxError) return 'SyntaxError'
  return 'Error'
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

export async function safeWriteSourceState(
  store: { writeSourceState?: (row: TrendSourceStateRow) => Promise<void> },
  row: TrendSourceStateRow,
): Promise<void> {
  if (store.writeSourceState === undefined) return
  try {
    await store.writeSourceState(row)
  } catch {
    // D1 일시 오류로 다른 출처나 섹션 전체가 중단되지 않도록 격리한다.
  }
}

/** 섹션 평가가 written/unchanged로 끝났을 때만 가상 source 'section:<id>'에 성공 시각을 남긴다. */
export async function writeSectionChecked(
  store: { writeSourceState?: (row: TrendSourceStateRow) => Promise<void> },
  section: TrendSection,
  nowMs: number,
): Promise<void> {
  await safeWriteSourceState(store, {
    source: sectionStateSourceId(section),
    etag: null,
    fetchedAt: nowMs,
    ok: true,
    httpStatus: null,
  })
}

async function fetchOnce(store: TrendStore, source: TrendSource, etag: string | null, nowMs: number): Promise<FetchedSource> {
  const fetched = await source.fetch(etag)
  if (!fetched.ok) {
    await safeWriteSourceState(store, {
      source: source.id,
      etag,
      fetchedAt: nowMs,
      ok: false,
      httpStatus: fetched.httpStatus,
    })
  } else if (fetched.notModified) {
    await safeWriteSourceState(store, {
      source: source.id,
      etag: fetched.etag ?? etag,
      fetchedAt: nowMs,
      ok: true,
      httpStatus: 304,
    })
  } else {
    await safeWriteSourceState(store, {
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
  let etag: string | null = null
  try {
    const state = await store.readSourceState(source.id)
    etag = state?.etag ?? null
  } catch {
    etag = null
  }
  try {
    return await fetchOnce(store, source, etag, nowMs)
  } catch {
    return { source, fetched: { ok: false, reason: 'network', httpStatus: null } }
  }
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
    return { ok: false, reason: 'source_failed', status: 'skipped' }
  }
  const payload = buildNewModels({ modelsDev: modelsDevRecords, openrouter: openrouterRecords, previous, sources, nowMs })
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  await writeSectionChecked(store, 'new-models', nowMs)
  return { ok: true, skipped: false, written: !unchanged, count: payload.items.length, status: unchanged ? 'unchanged' : 'written' }
}

async function applyFreeModels(
  store: TrendStore,
  goModels: FetchedSource | undefined,
  modelsDev: FetchedSource | undefined,
  nowMs: number,
): Promise<TrendSectionOutcome> {
  const row = await store.readSection('free-models')
  const previous = row === null ? null : parseSectionPayload<TrendSectionPayload>(row.payload, 'free-models')
  const nowIso = new Date(nowMs).toISOString()
  const sources = [sourceState(goModels, previous, nowIso)]
    .filter((source): source is TrendSourceState => source !== null)
  const goRecords = goModels !== undefined && isFresh(goModels.fetched) ? goModels.fetched.models ?? [] : null
  if (goRecords === null && previous === null) {
    return { ok: false, written: false, count: 0, stale: true, status: 'skipped', reason: 'source_failed' }
  }
  const catalog = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  const payload = buildFreeModels({ goModels: goRecords, catalog, previous, sources, nowMs })
  const stale = payload.sources.some((source) => source.status === 'stale')
  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  await writeSectionChecked(store, 'free-models', nowMs)
  return { ok: !stale, written: !unchanged, count: payload.items.length, stale, status: unchanged ? 'unchanged' : 'written' }
}

/** cron 경로: 출처·섹션별로 격리해 new-models와 free-models를 갱신한다. */
export async function refreshTrendSections(input: {
  store: TrendStore
  sources: readonly TrendSource[]
  nowMs: number
}): Promise<TrendRefreshAllResult> {
  const fetched = await Promise.all(input.sources.map((source) => fetchSource(input.store, source, input.nowMs)))
  const modelsDev = fetched.find((entry) => entry.source.id === TREND_SOURCE_MODELS_DEV)
  const goModels = fetched.find((entry) => entry.source.id === TREND_SOURCE_OPENCODE_GO)
  const openrouter = fetched.find((entry) => entry.source.id === TREND_SOURCE_OPENROUTER)
  let newModels: TrendRefreshResult
  try {
    newModels = await applyNewModels(input.store, modelsDev, openrouter, input.nowMs)
  } catch (error) {
    newModels = { ok: false, reason: 'section_error', status: 'error', errorClass: safeErrorClass(error) }
  }
  let freeModels: TrendSectionOutcome
  try {
    freeModels = await applyFreeModels(input.store, goModels, modelsDev, input.nowMs)
  } catch (error) {
    freeModels = { ok: false, written: false, count: 0, stale: true, status: 'error', errorClass: safeErrorClass(error) }
  }
  const sources: Record<string, 'ok' | 'stale'> = {}
  const sourceStatuses: Record<string, SourceHttpSummary> = {}
  for (const entry of fetched) {
    sources[entry.source.id] = entry.fetched.ok ? 'ok' : 'stale'
    sourceStatuses[entry.source.id] = !entry.fetched.ok ? 'fail' : entry.fetched.notModified ? '304' : '200'
  }
  const catalog = modelsDev !== undefined && isFresh(modelsDev.fetched) ? modelsDev.fetched.models ?? [] : null
  return { newModels, freeModels, sources, sourceStatuses, catalog }
}
