import { TREND_NEW_MODELS_RULE, TREND_SOURCE_MODELS_DEV } from '../../../shared/trend-contract'
import type { TrendSectionPayload } from '../../../shared/trend-contract'
import { buildNewModels } from '../../domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource } from '../../domain/trend/sources'
import type { TrendSeenRow, TrendStore } from '../../domain/trend/store'

export type TrendRefreshResult =
  | { ok: true; skipped: boolean; written: boolean; count: number }
  | { ok: false; reason: 'source_failed' }

function sameContent(existingPayload: string, next: TrendSectionPayload): boolean {
  try {
    const existing = JSON.parse(existingPayload) as TrendSectionPayload
    return existing.section === next.section &&
      existing.schemaVersion === next.schemaVersion &&
      existing.rule === next.rule &&
      JSON.stringify(existing.items) === JSON.stringify(next.items) &&
      JSON.stringify(existing.sources.map((source) => [source.id, source.status])) === JSON.stringify(next.sources.map((source) => [source.id, source.status]))
  } catch {
    return false
  }
}

async function markStale(store: TrendStore): Promise<void> {
  const row = await store.readSection('new-models')
  if (row === null) return
  try {
    const payload = JSON.parse(row.payload) as TrendSectionPayload
    if (!Array.isArray(payload.sources)) return
    const next: TrendSectionPayload = {
      ...payload,
      sources: payload.sources.map((source) => source.id === TREND_SOURCE_MODELS_DEV ? { ...source, status: 'stale' } : source),
    }
    if (JSON.stringify(next.sources.map((source) => [source.id, source.status])) === JSON.stringify(payload.sources.map((source) => [source.id, source.status]))) return
    await store.writeSection(next)
  } catch {
    // 기존 payload가 깨졌으면 stale 표시를 위해 덮어쓰지 않는다.
  }
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
    await markStale(input.store)
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
    return { ok: true, skipped: true, written: false, count: 0 }
  }
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
    etag: fetched.etag ?? state?.etag ?? null,
    fetchedAt: input.nowMs,
    ok: true,
    httpStatus: 200,
  })
  return { ok: true, skipped: false, written: !unchanged, count: payload.items.length }
}

export { TREND_NEW_MODELS_RULE }
