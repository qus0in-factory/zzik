import {
  TREND_METRICS_RULE,
  TREND_OR_LICENSE_NAME,
  TREND_OR_LICENSE_URL,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_OPENROUTER_RANKINGS,
} from '../../../shared/trend-contract'
import type {
  TrendMetricsBlock,
  TrendMetricsBlockStatus,
  TrendSourceState,
  TrendSectionPayload,
} from '../../../shared/trend-contract'
import { buildOrBlock, orAttribution } from '../../domain/trend/metrics/or'
import { addDays, utcDay } from '../../domain/trend/metrics/types'
import type {
  MetricsSourceFailureReason,
  MetricsStore,
  OrRankingSource,
} from '../../domain/trend/metrics/types'

const AA_RETENTION_DAYS = 90
const OR_RETENTION_DAYS = 60

export interface MetricsPayload extends TrendSectionPayload {
  blocks: TrendMetricsBlock[]
}

export interface MetricsRefreshResult {
  ok: boolean
  written: boolean
  notConfigured: boolean
  blocks: { or: TrendMetricsBlockStatus }
  reasons: { or: MetricsSourceFailureReason | null }
}

function parsePayload(text: string): MetricsPayload | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as MetricsPayload
    if (payload.section !== 'metrics' || !Array.isArray(payload.items) || !Array.isArray(payload.sources) || !Array.isArray(payload.blocks)) return null
    return payload
  } catch {
    return null
  }
}

function sameContent(previous: MetricsPayload, next: MetricsPayload): boolean {
  return previous.schemaVersion === next.schemaVersion &&
    previous.rule === next.rule &&
    JSON.stringify(previous.blocks) === JSON.stringify(next.blocks) &&
    JSON.stringify(previous.sources.map((source) => [source.id, source.status])) === JSON.stringify(next.sources.map((source) => [source.id, source.status]))
}

function notConfiguredOr(day: string): TrendMetricsBlock {
  return {
    id: 'or-usage', status: 'not_configured', asOf: day, entries: [], attribution: orAttribution(day),
    license: { name: TREND_OR_LICENSE_NAME, url: TREND_OR_LICENSE_URL }, processed: true,
  }
}

function staleBlock(previous: TrendMetricsBlock | undefined, fallback: TrendMetricsBlock): TrendMetricsBlock {
  const base = previous ?? fallback
  return { ...base, status: 'stale', note: 'source_failed' }
}

/**
 * 일 1회 metrics 갱신. Artificial Analysis 데이터는 공개 재배포가 불가하므로 수집·공개하지 않고
 * OpenRouter 사용량 블록만 만든다. OR 실패는 직전 블록을 stale로 유지한다.
 */
export async function refreshMetrics(input: {
  store: MetricsStore
  orSource: OrRankingSource | null
  nowMs: number
}): Promise<MetricsRefreshResult> {
  const { store, orSource, nowMs } = input
  const day = utcDay(nowMs)
  const nowIso = new Date(nowMs).toISOString()
  const row = await store.readSection('metrics')
  const previous = row === null ? null : parsePayload(row.payload)

  const or = orSource === null ? null : await orSource.fetch(nowMs)

  let orBlock: TrendMetricsBlock
  let orStatus: TrendMetricsBlockStatus
  let orReason: MetricsSourceFailureReason | null
  if (orSource === null || or === null) {
    orBlock = notConfiguredOr(day)
    orStatus = 'not_configured'
    orReason = 'not_configured'
  } else if (or.ok) {
    try {
      await store.writeOrRanking(or.snapshot.rows, or.snapshot.asOf, or.snapshot.meta)
      orBlock = buildOrBlock({
        rows: or.snapshot.rows, today: day, asOf: or.snapshot.asOf, asOfKind: or.snapshot.asOfKind, meta: or.snapshot.meta,
      })
      orStatus = 'ok'
      orReason = null
    } catch {
      const fallback: TrendMetricsBlock = {
        id: 'or-usage', status: 'stale', asOf: day, note: 'source_failed', entries: [], attribution: orAttribution(day),
        license: { name: TREND_OR_LICENSE_NAME, url: TREND_OR_LICENSE_URL }, processed: true,
      }
      orBlock = staleBlock(previous?.blocks.find((block) => block.id === 'or-usage'), fallback)
      orStatus = 'stale'
      orReason = 'storage'
    }
  } else {
    const fallback: TrendMetricsBlock = {
      id: 'or-usage', status: 'stale', asOf: day, note: 'source_failed', entries: [], attribution: orAttribution(day),
      license: { name: TREND_OR_LICENSE_NAME, url: TREND_OR_LICENSE_URL }, processed: true,
    }
    orBlock = staleBlock(previous?.blocks.find((block) => block.id === 'or-usage'), fallback)
    orStatus = 'stale'
    orReason = or.reason
  }

  try {
    await store.prune(addDays(day, -AA_RETENTION_DAYS), addDays(day, -OR_RETENTION_DAYS))
  } catch {
    // 보존 기간 정리는 실패해도 공개 섹션 갱신을 막지 않는다.
  }

  const sources: TrendSourceState[] = orSource === null
    ? []
    : [{ id: TREND_SOURCE_OPENROUTER_RANKINGS, fetchedAt: nowIso, status: orStatus === 'ok' ? 'ok' : 'stale' }]

  const payload: MetricsPayload = {
    section: 'metrics',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: nowIso,
    rule: TREND_METRICS_RULE,
    sources,
    items: [],
    blocks: [orBlock],
  }

  const anyOk = orStatus === 'ok'
  const allNotConfigured = orStatus === 'not_configured'
  if (!anyOk && previous === null && !allNotConfigured) {
    return { ok: false, written: false, notConfigured: false, blocks: { or: orStatus }, reasons: { or: orReason } }
  }
  if (allNotConfigured && previous === null) {
    return { ok: false, written: false, notConfigured: true, blocks: { or: orStatus }, reasons: { or: orReason } }
  }

  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  return { ok: anyOk, written: !unchanged, notConfigured: allNotConfigured, blocks: { or: orStatus }, reasons: { or: orReason } }
}
