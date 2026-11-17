import {
  TREND_METRICS_RULE,
  TREND_OR_LICENSE_NAME,
  TREND_OR_LICENSE_URL,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_ARTIFICIAL_ANALYSIS,
  TREND_SOURCE_OPENROUTER_RANKINGS,
} from '../../../shared/trend-contract'
import type {
  TrendMetricsBlock,
  TrendMetricsBlockStatus,
  TrendSourceState,
  TrendSectionPayload,
} from '../../../shared/trend-contract'
import { aaAttribution, buildAaBlock, fromAaRows, rankAa, toAaRows } from '../../domain/trend/metrics/aa'
import { buildOrBlock, orAttribution } from '../../domain/trend/metrics/or'
import { addDays, utcDay } from '../../domain/trend/metrics/types'
import type {
  AaSource,
  MetricsSourceFailureReason,
  MetricsStore,
  OrRankingSource,
} from '../../domain/trend/metrics/types'

const AA_TOP_STORED = 50
const AA_RETENTION_DAYS = 90
const OR_RETENTION_DAYS = 60

export interface MetricsPayload extends TrendSectionPayload {
  blocks: TrendMetricsBlock[]
}

export interface MetricsRefreshResult {
  ok: boolean
  written: boolean
  notConfigured: boolean
  blocks: { aa: TrendMetricsBlockStatus; or: TrendMetricsBlockStatus }
  reasons: { aa: MetricsSourceFailureReason | null; or: MetricsSourceFailureReason | null }
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

function notConfiguredAa(day: string): TrendMetricsBlock {
  return { id: 'aa-intelligence', status: 'not_configured', asOf: day, entries: [], attribution: aaAttribution('', day) }
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
 * 일 1회 metrics 갱신. AA/OR는 서로 독립적으로 실패·성공하며, 실패한 블록은
 * 직전 공개 payload의 같은 블록을 stale로 유지한다. 키가 없으면 해당 블록만
 * not_configured가 되고 네트워크 호출은 하지 않는다.
 */
export async function refreshMetrics(input: {
  store: MetricsStore
  aaSource: AaSource | null
  orSource: OrRankingSource | null
  nowMs: number
}): Promise<MetricsRefreshResult> {
  const { store, aaSource, orSource, nowMs } = input
  const day = utcDay(nowMs)
  const nowIso = new Date(nowMs).toISOString()
  const row = await store.readSection('metrics')
  const previous = row === null ? null : parsePayload(row.payload)

  const [aa, or] = await Promise.all([
    aaSource === null ? Promise.resolve(null) : aaSource.fetch(nowMs),
    orSource === null ? Promise.resolve(null) : orSource.fetch(nowMs),
  ])

  let aaBlock: TrendMetricsBlock
  let aaStatus: TrendMetricsBlockStatus
  let aaReason: MetricsSourceFailureReason | null
  if (aaSource === null || aa === null) {
    aaBlock = notConfiguredAa(day)
    aaStatus = 'not_configured'
    aaReason = 'not_configured'
  } else if (aa.ok) {
    try {
      const ranked = rankAa(aa.snapshot.entries).slice(0, AA_TOP_STORED).map((item) => item.entry)
      const stored = { version: aa.snapshot.version, entries: ranked }
      await store.writeAaSnapshot(day, toAaRows(stored, day))
      const previousRows = await store.readAaSnapshot(addDays(day, -7))
      const previousSnapshot = previousRows.length === 0 ? null : fromAaRows(previousRows, previousRows[0]!.indexVersion)
      aaBlock = buildAaBlock({ today: stored, previous: previousSnapshot, asOf: day })
      aaStatus = 'ok'
      aaReason = null
    } catch {
      // 저장소 예외가 OR 갱신을 막지 않도록 이 출처만 stale로 낮춘다.
      const fallback: TrendMetricsBlock = { id: 'aa-intelligence', status: 'stale', asOf: day, note: 'source_failed', entries: [], attribution: aaAttribution('', day) }
      aaBlock = staleBlock(previous?.blocks.find((block) => block.id === 'aa-intelligence'), fallback)
      aaStatus = 'stale'
      aaReason = 'storage'
    }
  } else {
    const fallback: TrendMetricsBlock = { id: 'aa-intelligence', status: 'stale', asOf: day, note: 'source_failed', entries: [], attribution: aaAttribution('', day) }
    aaBlock = staleBlock(previous?.blocks.find((block) => block.id === 'aa-intelligence'), fallback)
    aaStatus = 'stale'
    aaReason = aa.reason
  }

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

  const sources: TrendSourceState[] = []
  if (aaSource !== null) sources.push({ id: TREND_SOURCE_ARTIFICIAL_ANALYSIS, fetchedAt: nowIso, status: aaStatus === 'ok' ? 'ok' : 'stale' })
  if (orSource !== null) sources.push({ id: TREND_SOURCE_OPENROUTER_RANKINGS, fetchedAt: nowIso, status: orStatus === 'ok' ? 'ok' : 'stale' })

  const payload: MetricsPayload = {
    section: 'metrics',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: nowIso,
    rule: TREND_METRICS_RULE,
    sources,
    items: [],
    blocks: [aaBlock, orBlock],
  }

  const anyOk = aaStatus === 'ok' || orStatus === 'ok'
  const allNotConfigured = aaStatus === 'not_configured' && orStatus === 'not_configured'
  // 첫 수집부터 모든 출처가 실패하면 빈 섹션을 만들지 않는다(not_ready 유지).
  if (!anyOk && previous === null && !allNotConfigured) {
    return {
      ok: false,
      written: false,
      notConfigured: false,
      blocks: { aa: aaStatus, or: orStatus },
      reasons: { aa: aaReason, or: orReason },
    }
  }
  if (allNotConfigured && previous === null) {
    return { ok: false, written: false, notConfigured: true, blocks: { aa: aaStatus, or: orStatus }, reasons: { aa: aaReason, or: orReason } }
  }

  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  return {
    ok: anyOk,
    written: !unchanged,
    notConfigured: allNotConfigured,
    blocks: { aa: aaStatus, or: orStatus },
    reasons: { aa: aaReason, or: orReason },
  }
}
