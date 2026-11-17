import { TREND_NEW_MODELS_RULE, TREND_SOURCE_MODELS_DEV } from '../../../shared/trend-contract'
import type { TrendSectionPayload } from '../../../shared/trend-contract'
import { buildNewModels, reevaluateNewModels } from '../../domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource, TrendSourceFetchResult } from '../../domain/trend/sources'
import type { TrendSeenRow, TrendStore } from '../../domain/trend/store'

export type TrendRefreshResult =
  | { ok: true; skipped: boolean; written: boolean; count: number }
  | { ok: false; reason: 'source_failed' }

function parsePayload(text: string): TrendSectionPayload | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as TrendSectionPayload
    if (payload.section !== 'new-models' || !Array.isArray(payload.items) || !Array.isArray(payload.sources)) return null
    return payload
  } catch {
    return null
  }
}

function sameContent(existingPayload: string, next: TrendSectionPayload): boolean {
  const existing = parsePayload(existingPayload)
  if (existing === null) return false
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
  const payload = parsePayload(row.payload)
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

async function applyFresh(
  input: { store: TrendStore; source: TrendSource; nowMs: number },
  fetched: TrendSourceFetchResult,
): Promise<TrendRefreshResult> {
  const models = fetched.models ?? []
  const seenRows = await input.store.readSeen()
  const seen = new Map(seenRows.map((row) => [row.canonicalId, row.firstSeenAt]))
  const payload = buildNewModels(models, seen, input.nowMs)
  const existing = await input.store.readSection('new-models')
  const unchanged = existing !== null && sameContent(existing.payload, payload)
  if (!unchanged) await input.store.writeSection(payload)
  await input.store.upsertSeen(newSeenRows(models, seen, input.nowMs))
  await input.store.writeSourceState({
    source: input.source.id,
    etag: fetched.etag,
    fetchedAt: input.nowMs,
    ok: true,
    httpStatus: 200,
  })
  return { ok: true, skipped: false, written: !unchanged, count: payload.items.length }
}

/** models.dev 한 출처를 조건부로 읽어 new-models 섹션과 seen/source 상태를 갱신한다. */
export async function refreshTrend(input: { store: TrendStore; source: TrendSource; nowMs: number }): Promise<TrendRefreshResult> {
  const state = await input.store.readSourceState(input.source.id)
  const fetched = await input.source.fetch(state?.etag ?? null)
  if (!fetched.ok) {
    await input.store.writeSourceState({
      source: input.source.id,
      etag: state?.etag ?? null,
      fetchedAt: input.nowMs,
      ok: false,
      httpStatus: fetched.httpStatus,
    })
    await markStale(input.store, input.nowMs)
    return { ok: false, reason: 'source_failed' }
  }
  if (fetched.notModified) {
    await input.store.writeSourceState({
      source: input.source.id,
      etag: fetched.etag ?? state?.etag ?? null,
      fetchedAt: input.nowMs,
      ok: true,
      httpStatus: 304,
    })
    const row = await input.store.readSection('new-models')
    if (row === null) return { ok: true, skipped: true, written: false, count: 0 }
    const payload = parsePayload(row.payload)
    if (payload === null) return { ok: true, skipped: true, written: false, count: 0 }
    // 304는 출처 상태를 회복시키고, 저장된 firstSeenAt/releaseMs로 7일 창을 다시 적용한다.
    const recovered = withSourceStatus(payload, 'ok', new Date(input.nowMs).toISOString())
    const reevaluated = reevaluateNewModels(recovered, input.nowMs)
    if (reevaluated === null) {
      // 이전 스키마(정규화 메타데이터 없음)면 조건 없이 한 번 더 받아 재구성한다.
      const refreshed = await input.source.fetch(null)
      if (!refreshed.ok || refreshed.notModified) return { ok: true, skipped: true, written: false, count: 0 }
      return applyFresh(input, refreshed)
    }
    if (sameContent(row.payload, reevaluated)) return { ok: true, skipped: true, written: false, count: reevaluated.items.length }
    await input.store.writeSection(reevaluated)
    return { ok: true, skipped: false, written: true, count: reevaluated.items.length }
  }
  return applyFresh(input, fetched)
}

export { TREND_NEW_MODELS_RULE }
