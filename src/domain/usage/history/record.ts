/**
 * 이력 캐시 레코드의 순수 함수(ADR 0.7 6.2절). 불변식 I1~I6이 기준이다.
 * 저장소 접근은 없다 — `update`의 `mutate`로 넘기는 동기 순수 함수만 만든다(I5).
 */
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'
import type { UsageHistoryPage, UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { UsageProvider } from '../providers'
import type { HistoryCacheRecord } from './types'

export const HISTORY_RECORD_MAX_SAMPLES = 4_000
export const HISTORY_RECORD_MAX_AGE_MS = 31 * 86_400_000
/** 커서가 이보다 오래됐으면 정방향 이어받기 대신 레코드를 버리고 처음부터(6.3절). */
export const HISTORY_FORWARD_MAX_AGE_MS = 30 * 86_400_000

export interface Coverage {
  coveredFrom: string | null
  cursor: string | null
}

export function sampleCursor(sample: UsageHistorySample): string {
  return `${sample.runAt}_${sample.id}`
}

/** 커서(`<runAt>_<id>`) 순서. id는 10진 문자열이라 길이 → 사전순(= 수 비교)으로 비교한다. */
export function compareCursors(a: string, b: string): number {
  const [aRun = '', aId = ''] = a.split('_')
  const [bRun = '', bId = ''] = b.split('_')
  if (aRun !== bRun) return aRun < bRun ? -1 : 1
  if (aId.length !== bId.length) return aId.length < bId.length ? -1 : 1
  return aId === bId ? 0 : aId < bId ? -1 : 1
}

const compareSamples = (a: UsageHistorySample, b: UsageHistorySample): number => compareCursors(sampleCursor(a), sampleCursor(b))

/** id 기준 합집합, (runAt, id) 오름차순. 같은 id는 새 쪽 값으로 바뀐다(멱등). */
export function mergeSamples(existing: readonly UsageHistorySample[], incoming: readonly UsageHistorySample[]): UsageHistorySample[] {
  const byId = new Map<string, UsageHistorySample>()
  for (const sample of existing) byId.set(sample.id, sample)
  for (const sample of incoming) byId.set(sample.id, sample)
  return [...byId.values()].sort(compareSamples)
}

export function createRecord(provider: UsageProvider, nowIso: string): HistoryCacheRecord {
  return { v: 1, scanVersion: USAGE_HISTORY_SCAN_VERSION, provider, coveredFrom: null, cursor: null, anchor: null, samples: [], labels: {}, seriesOrder: [], syncedThroughRunAt: null, syncedAt: nowIso }
}

export function coverageOf(record: HistoryCacheRecord | null): Coverage | null {
  return record === null ? null : { coveredFrom: record.coveredFrom, cursor: record.cursor }
}

const sameCoverage = (a: Coverage | null, b: Coverage | null): boolean => (a === null || b === null ? a === b : a.coveredFrom === b.coveredFrom && a.cursor === b.cursor)

/** I6: 형식·버전·제공자가 맞지 않으면 null(레코드 전체 폐기). 일부만 살리지 않는다. */
export function validateRecord(raw: unknown, provider: UsageProvider): HistoryCacheRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Partial<HistoryCacheRecord>
  if (record.v !== 1 || record.scanVersion !== USAGE_HISTORY_SCAN_VERSION || record.provider !== provider) return null
  if (!Array.isArray(record.samples) || !Array.isArray(record.seriesOrder)) return null
  if (typeof record.labels !== 'object' || record.labels === null || typeof record.syncedAt !== 'string') return null
  return raw as HistoryCacheRecord
}

function addSeries(order: readonly string[], samples: readonly (UsageHistorySample | null)[]): string[] {
  const next = [...order]
  for (const sample of samples) for (const value of sample?.values ?? []) if (!next.includes(value.id)) next.push(value.id)
  return next
}

/** 31일·4,000표본을 넘는 오래된 표본을 버린다. 버린 구간은 coveredFrom·anchor가 따라간다(I1 유지). */
export function pruneRecord(record: HistoryCacheRecord, nowMs: number): HistoryCacheRecord {
  const cutoff = nowMs - HISTORY_RECORD_MAX_AGE_MS
  const timeOf = (sample: UsageHistorySample): number => Date.parse(sample.fetchedAt ?? sample.runAt)
  let keepFrom = record.samples.findIndex((sample) => timeOf(sample) >= cutoff)
  if (keepFrom === -1) keepFrom = record.samples.length
  keepFrom = Math.max(keepFrom, record.samples.length - HISTORY_RECORD_MAX_SAMPLES)
  if (keepFrom <= 0) return record
  const dropped = record.samples.slice(0, keepFrom)
  const kept = record.samples.slice(keepFrom)
  const lastOkDropped = [...dropped].reverse().find((sample) => sample.status === 'ok') ?? null
  const boundary = kept[0]?.runAt ?? null
  const coveredFrom = boundary !== null && (record.coveredFrom === null || boundary > record.coveredFrom) ? boundary : record.coveredFrom
  return { ...record, samples: kept, anchor: lastOkDropped ?? record.anchor, coveredFrom }
}

export interface CommitContext {
  provider: UsageProvider
  now: string
  /** 레코드가 없을 때 첫 쪽의 `from`(= coveredFrom이 되는 값) */
  initialFrom: string | null
}

/**
 * 정방향 쪽 저장(I2·I3·I4). `expected`는 이 쪽을 받기 전에 읽은 커버리지이고, 지금 저장된 것과 다르면 null을 돌려
 * 쓰지 않게 한다. 레코드가 없으면 첫 쪽이 coveredFrom과 anchor를 함께 만든다.
 */
export function applyForward(current: HistoryCacheRecord | null, expected: Coverage | null, page: UsageHistoryPage, context: CommitContext): HistoryCacheRecord | null {
  if (!sameCoverage(coverageOf(current), expected)) return null
  const base = current ?? { ...createRecord(context.provider, context.now), coveredFrom: context.initialFrom, anchor: page.anchor }
  const cursor = page.nextCursor !== null && (base.cursor === null || compareCursors(page.nextCursor, base.cursor) > 0) ? page.nextCursor : base.cursor
  const samples = mergeSamples(base.samples, page.samples)
  return pruneRecord({ ...base, cursor, samples, seriesOrder: addSeries(base.seriesOrder, samples) }, Date.parse(context.now))
}

export interface BackfillChunk {
  /** 조각의 시작 시각(이상). 조각이 끝까지 받아졌을 때만 저장한다. */
  from: string
  samples: UsageHistorySample[]
  anchor: UsageHistorySample | null
}

/** 백필 조각 저장: coveredFrom은 과거로만 움직이고(I2), 조각의 anchor가 이전 anchor를 대체한다. 커서는 앞으로만(I3). */
export function applyBackfill(current: HistoryCacheRecord | null, expected: Coverage | null, chunk: BackfillChunk, context: CommitContext): HistoryCacheRecord | null {
  if (current === null || !sameCoverage(coverageOf(current), expected)) return null
  const earlier = current.coveredFrom === null || chunk.from < current.coveredFrom
  const samples = mergeSamples(current.samples, chunk.samples)
  const last = chunk.samples.at(-1)
  const lastCursor = last === undefined ? null : sampleCursor(last)
  const cursor = lastCursor !== null && (current.cursor === null || compareCursors(lastCursor, current.cursor) > 0) ? lastCursor : current.cursor
  return pruneRecord(
    { ...current, coveredFrom: earlier ? chunk.from : current.coveredFrom, anchor: earlier ? chunk.anchor : current.anchor, cursor, samples, seriesOrder: addSeries(current.seriesOrder, samples) },
    Date.parse(context.now),
  )
}

/** 카드에서 본 라벨을 기억한다. 바뀐 게 없으면 같은 레코드를 돌려준다. */
export function withLabels(record: HistoryCacheRecord, labels: Record<string, string>): HistoryCacheRecord {
  const changed = Object.entries(labels).filter(([id, label]) => record.labels[id] !== label)
  return changed.length === 0 ? record : { ...record, labels: { ...record.labels, ...Object.fromEntries(changed) } }
}

export function withSync(record: HistoryCacheRecord, syncedThroughRunAt: string | null, nowIso: string): HistoryCacheRecord {
  return { ...record, syncedThroughRunAt, syncedAt: nowIso }
}

/** 커서가 30일보다 오래되면 정방향으로 이어받지 않고 레코드를 버린다(6.3절). */
export function isForwardStale(record: HistoryCacheRecord, nowMs: number): boolean {
  if (record.cursor === null) return false
  const runAt = Date.parse(record.cursor.split('_')[0] ?? '')
  return Number.isFinite(runAt) && nowMs - runAt > HISTORY_FORWARD_MAX_AGE_MS
}
