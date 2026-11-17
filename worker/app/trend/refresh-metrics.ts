import {
  TREND_AA_SNAPSHOT_TOP_N,
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
import { buildAaCitation, rankAa, toAaRows } from '../../domain/trend/metrics/aa'
import { buildOrBlock, orAttribution } from '../../domain/trend/metrics/or'
import { addDays, utcDay } from '../../domain/trend/metrics/types'
import { writeSectionChecked } from './refresh-trend'
import type {
  AaSource,
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
  aa: { status: 'ok' | 'stale' | 'not_configured'; reason: MetricsSourceFailureReason | null }
  aaCitation?: string
}

/** 진단 출력용 고정 토큰. 키·응답 원문은 포함하지 않는다. */
export function aaStatusToken(aa: MetricsRefreshResult['aa']): string {
  if (aa.status === 'ok') return 'ok'
  if (aa.status === 'not_configured') return 'not_configured'
  if (aa.reason === null) return 'error'
  return aa.reason === 'rate_limited' ? '429' : aa.reason
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
    previous.aaCitation === next.aaCitation &&
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
 * 일 1회 metrics 갱신. AA는 무료 API를 Internal Use로 호출해 상위 2개만 내부 저장하고,
 * 공개 payload에는 지표당 1위 한 건을 담은 brief citation 문장 하나만 둔다(구조화 필드 없음).
 * 키 없음·실패 시 문장을 숨긴다. OR 실패는 직전 블록을 stale로 유지한다.
 */
export async function refreshMetrics(input: {
  store: MetricsStore
  orSource: OrRankingSource | null
  aaSource?: AaSource | null
  nowMs: number
}): Promise<MetricsRefreshResult> {
  const { store, orSource, aaSource, nowMs } = input
  const day = utcDay(nowMs)
  const nowIso = new Date(nowMs).toISOString()
  const row = await store.readSection('metrics')
  const previous = row === null ? null : parsePayload(row.payload)

  let aaCitation: string | undefined
  let aaStatus: 'ok' | 'stale' | 'not_configured' = 'not_configured'
  let aaReason: MetricsSourceFailureReason | null = 'not_configured'
  if (aaSource !== undefined && aaSource !== null) {
    try {
      const aa = await aaSource.fetch(nowMs)
      if (aa.ok) {
        try {
          // 내부 패널용으로 상위 50개를 저장하고, 공개 문장은 buildAaCitation이 상위 일부만 본다.
          const top = rankAa(aa.snapshot.entries).slice(0, TREND_AA_SNAPSHOT_TOP_N).map(({ entry }) => entry)
          await store.writeAaSnapshot(day, toAaRows({ version: aa.snapshot.version, entries: top }, day))
          aaCitation = buildAaCitation({ version: aa.snapshot.version, entries: top }) ?? undefined
          if (aaCitation === undefined) {
            aaStatus = 'stale'
            aaReason = 'rejected'
          } else {
            aaStatus = 'ok'
            aaReason = null
          }
        } catch {
          aaStatus = 'stale'
          aaReason = 'storage'
        }
      } else {
        aaStatus = 'stale'
        aaReason = aa.reason
      }
    } catch {
      // 계약 밖 포트 예외도 OpenRouter 갱신을 막지 않는다.
      aaStatus = 'stale'
      aaReason = 'network'
    }
  }

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
    ...(aaCitation === undefined ? {} : { aaCitation }),
  }

  // AA 인용도 유효한 출처다. OR이 없어도 인용이 있으면 최초 섹션을 만든다.
  const aaOk = aaStatus === 'ok' && aaCitation !== undefined
  const anyOk = orStatus === 'ok' || aaOk
  const allNotConfigured = orStatus === 'not_configured' && aaStatus === 'not_configured'
  const aa = { status: aaStatus, reason: aaReason }
  const citation = aaCitation === undefined ? {} : { aaCitation }
  if (!anyOk && previous === null && !allNotConfigured) {
    return { ok: false, written: false, notConfigured: false, blocks: { or: orStatus }, reasons: { or: orReason }, aa, ...citation }
  }
  if (allNotConfigured && previous === null) {
    return { ok: false, written: false, notConfigured: true, blocks: { or: orStatus }, reasons: { or: orReason }, aa, ...citation }
  }

  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload)
  await writeSectionChecked(store, 'metrics', nowMs)
  return { ok: anyOk, written: !unchanged, notConfigured: allNotConfigured, blocks: { or: orStatus }, reasons: { or: orReason }, aa, ...citation }
}
