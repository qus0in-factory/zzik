/**
 * ADR 0.10 §6.1 export and §6.2 restore contracts.
 * Pure constants, row/document shapes and validation. No clock, I/O or driver.
 */
import { isDecimalEventId, isRecord, isUsageProvider, isUsageStatus } from '../../../shared/d1-canonical'
import { TREND_REFRESH_INTERVAL_HOURS } from '../../../shared/trend-contract'
import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract'

/** The daily export cron. E's 15-minute bucket writer keeps its own string. */
export const EXPORT_CRON = '0 3 * * *'
export const BUCKET_CRON = '*/15 * * * *'
/** Public trend refresh, off the other cron boundaries. */
export const TREND_CRON = `7 */${TREND_REFRESH_INTERVAL_HOURS} * * *`
/** Public metrics refresh: daily, after the trend collection cron. */
export const METRICS_CRON = '17 0 * * *'

/** ADR cap: a page never exceeds 1,000 rows. */
export const EXPORT_EVENT_PAGE_MAX_ROWS = 1_000
/**
 * Chosen event page size. 100 worst-case 64KiB envelopes stay well inside the
 * 128MB Worker limit before the 4MB SQL cut applies.
 */
export const EXPORT_EVENT_PAGE_ROWS = 100
/** Receipt rows are small, so a larger page keeps the first export efficient. */
export const EXPORT_RECEIPT_PAGE_MAX_ROWS = 1_000
export const EXPORT_EVENT_PAGE_MAX_BYTES = 4 * 1024 * 1024
/** ADR: one object part stays below 5MiB and is split at a page boundary. */
export const EXPORT_PART_MAX_BYTES = 5 * 1024 * 1024
/** ADR §6.2: the next automatic id is at least the restored maximum plus this margin. */
export const EXPORT_RESTORE_FENCE_MARGIN = 1_000_000
export const EXPORT_DOCUMENT_VERSION = 1

const SIGNED_64_MAX = 9223372036854775807n

export type ExportCronKind = 'export' | 'bucket' | 'trend' | 'metrics' | 'unknown'
export type ExportResult<T> = { ok: true; value: T } | { ok: false; reason: 'invalid_export_object' }

export interface ExportManifest {
  eventHighWaterId: string
  receiptCutMs: number
  dataGeneration: number
  exportedAtMs: number
}

export interface ExportEventRow {
  id: string
  provider: UsageProvider
  runAtMs: number
  status: UsageStatus
  rawSha256: string | null
  envelope: string
  operationId: string | null
}

export interface ExportSnapshotRow {
  provider: UsageProvider
  envelope: string
  status: UsageStatus
  runAtMs: number
  fetchedAtMs: number | null
  rawSha256: string | null
  collectorVersion: string
  updatedAtMs: number
  writeSeq: number
  operationId: string | null
}

export interface ExportReceiptRow {
  operationId: string
  provider: UsageProvider
  writeSeq: number
  payloadSha256: string
  createdAtMs: number
}

export interface ExportDocument {
  version: 1
  part: number
  manifest: ExportManifest
  events: ExportEventRow[]
  snapshots: ExportSnapshotRow[]
  receipts: ExportReceiptRow[]
}

export interface ExportLogRow {
  ranAtMs: number
  objectKey: string
  eventHighWaterId: string
  receiptCutMs: number
  dataGeneration: number
  bytes: number
  ok: 0 | 1
}

export interface ReceiptCursor {
  /** Inclusive lower bound: receipts at this millisecond are still pending. */
  createdAtMs: number
  operationId: string | null
}

/** Ports implemented by infra and consumed by app. Domain owns the shape only. */
export interface ExportSource {
  readLastOkLog(dataGeneration: number): Promise<ExportLogRow | null>
  readEventPage(afterId: string, maxRows: number, maxBytes: number): Promise<ExportEventRow[]>
  readSnapshots(): Promise<ExportSnapshotRow[]>
  readReceiptPage(cursor: ReceiptCursor, maxRows: number): Promise<ExportReceiptRow[]>
  readLastPartNumber(dateKey: string): Promise<number>
  appendLog(row: ExportLogRow): Promise<void>
}

export interface ExportSink {
  putObject(key: string, body: string): Promise<number>
}

export interface ExportObjectReader {
  list(prefix?: string): Promise<string[]>
  read(key: string): Promise<string | null>
}

export interface RestoreTarget {
  insertEvent(row: ExportEventRow): Promise<'inserted' | 'skipped'>
  upsertSnapshot(row: ExportSnapshotRow): Promise<'inserted' | 'updated' | 'skipped'>
  insertReceipt(row: ExportReceiptRow): Promise<'inserted' | 'skipped'>
  fenceSequence(nextId: string): Promise<void>
}

export function classifyScheduledCron(cron: string | undefined): ExportCronKind {
  if (cron === EXPORT_CRON) return 'export'
  if (cron === BUCKET_CRON) return 'bucket'
  if (cron === TREND_CRON) return 'trend'
  if (cron === METRICS_CRON) return 'metrics'
  return 'unknown'
}

export function parseDataGeneration(value: string | undefined): number | null {
  if (value === undefined || value === '') return 0
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function jsonByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** UTC date and part number only, per ADR §6.1. */
export function exportObjectKey(exportedAtMs: number, part: number): string {
  if (!Number.isSafeInteger(exportedAtMs) || exportedAtMs < 0) throw new Error('invalid_export_time')
  if (!Number.isSafeInteger(part) || part < 1 || part > 999_999) throw new Error('invalid_part')
  const date = new Date(exportedAtMs)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_export_time')
  return `${date.toISOString().slice(0, 10)}/part-${String(part).padStart(4, '0')}.json`
}

export function partNumberFromObjectKey(key: string): number | null {
  const match = /^\d{4}-\d\d-\d\d\/part-(\d{4,6})\.json$/.exec(key)
  if (match === null) return null
  const part = Number(match[1])
  return Number.isSafeInteger(part) && part > 0 ? part : null
}

export function compareDecimalIds(a: string, b: string): number {
  const left = BigInt(a), right = BigInt(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * SQL-equivalent 4MB cut: a row is included while the bytes before it are
 * still below the limit, so a page always makes progress even for one large row.
 */
export function trimRowsByEnvelopeBytes<T extends { envelope: string }>(
  rows: readonly T[],
  maxBytes: number = EXPORT_EVENT_PAGE_MAX_BYTES,
): T[] {
  const selected: T[] = []
  let cumulative = 0
  for (const row of rows) {
    if (selected.length > 0 && cumulative >= maxBytes) break
    selected.push(row)
    cumulative += jsonByteLength(row.envelope)
  }
  return selected
}

/** Split rows at row boundaries so a serialized part stays under the budget unless a single row is larger. */
export function chunkRowsByEncodedBytes<T>(rows: readonly T[], maxBytes: number = EXPORT_PART_MAX_BYTES): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const row of rows) {
    const rowBytes = jsonByteLength(JSON.stringify(row))
    if (current.length > 0 && bytes + rowBytes > maxBytes) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(row)
    bytes += rowBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

export function buildExportDocument(input: {
  part: number
  manifest: ExportManifest
  events?: readonly ExportEventRow[]
  snapshots?: readonly ExportSnapshotRow[]
  receipts?: readonly ExportReceiptRow[]
}): ExportDocument {
  return {
    version: EXPORT_DOCUMENT_VERSION,
    part: input.part,
    manifest: {
      eventHighWaterId: input.manifest.eventHighWaterId,
      receiptCutMs: input.manifest.receiptCutMs,
      dataGeneration: input.manifest.dataGeneration,
      exportedAtMs: input.manifest.exportedAtMs,
    },
    events: [...(input.events ?? [])],
    snapshots: [...(input.snapshots ?? [])],
    receipts: [...(input.receipts ?? [])],
  }
}

export function serializeExportDocument(document: ExportDocument): string {
  return JSON.stringify(document)
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isNullableInt(value: unknown): value is number | null {
  return value === null || isInt(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isEnvelopeObject(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return isRecord(JSON.parse(value))
  } catch {
    return false
  }
}

function validEventRow(value: unknown): value is ExportEventRow {
  return isRecord(value)
    && isDecimalEventId(value.id)
    && isUsageProvider(value.provider)
    && isInt(value.runAtMs)
    && isUsageStatus(value.status)
    && isNullableString(value.rawSha256)
    && isEnvelopeObject(value.envelope)
    && (value.operationId === null || isNonEmptyString(value.operationId))
}

function validSnapshotRow(value: unknown): value is ExportSnapshotRow {
  return isRecord(value)
    && isUsageProvider(value.provider)
    && isEnvelopeObject(value.envelope)
    && isUsageStatus(value.status)
    && isInt(value.runAtMs)
    && isNullableInt(value.fetchedAtMs)
    && isNullableString(value.rawSha256)
    && isNonEmptyString(value.collectorVersion)
    && isInt(value.updatedAtMs)
    && isNonNegativeInt(value.writeSeq)
    && (value.operationId === null || isNonEmptyString(value.operationId))
}

function validReceiptRow(value: unknown): value is ExportReceiptRow {
  return isRecord(value)
    && isNonEmptyString(value.operationId)
    && isUsageProvider(value.provider)
    && isNonNegativeInt(value.writeSeq) && value.writeSeq > 0
    && isNonEmptyString(value.payloadSha256)
    && isInt(value.createdAtMs)
}

export function parseExportDocument(text: string): ExportResult<ExportDocument> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid_export_object' }
  }
  if (!isRecord(parsed) || parsed.version !== EXPORT_DOCUMENT_VERSION || !isNonNegativeInt(parsed.part) || parsed.part < 1) {
    return { ok: false, reason: 'invalid_export_object' }
  }
  if (!isRecord(parsed.manifest)) return { ok: false, reason: 'invalid_export_object' }
  const manifest = parsed.manifest
  if (!(manifest.eventHighWaterId === '0' || isDecimalEventId(manifest.eventHighWaterId))
    || !isNonNegativeInt(manifest.receiptCutMs)
    || !isNonNegativeInt(manifest.dataGeneration)
    || !isNonNegativeInt(manifest.exportedAtMs)) {
    return { ok: false, reason: 'invalid_export_object' }
  }
  if (!Array.isArray(parsed.events) || !parsed.events.every(validEventRow)) return { ok: false, reason: 'invalid_export_object' }
  if (!Array.isArray(parsed.snapshots) || !parsed.snapshots.every(validSnapshotRow)) return { ok: false, reason: 'invalid_export_object' }
  if (!Array.isArray(parsed.receipts) || !parsed.receipts.every(validReceiptRow)) return { ok: false, reason: 'invalid_export_object' }

  const events = parsed.events as ExportEventRow[]
  for (let index = 1; index < events.length; index += 1) {
    if (compareDecimalIds(events[index - 1]!.id, events[index]!.id) >= 0) return { ok: false, reason: 'invalid_export_object' }
  }
  if (events.length > 0 && manifest.eventHighWaterId !== events[events.length - 1]!.id) {
    return { ok: false, reason: 'invalid_export_object' }
  }
  const receipts = parsed.receipts as ExportReceiptRow[]
  if (receipts.length > 0 && manifest.receiptCutMs < receipts[receipts.length - 1]!.createdAtMs) {
    return { ok: false, reason: 'invalid_export_object' }
  }

  return {
    ok: true,
    value: {
      version: EXPORT_DOCUMENT_VERSION,
      part: parsed.part,
      manifest: {
        eventHighWaterId: manifest.eventHighWaterId,
        receiptCutMs: manifest.receiptCutMs,
        dataGeneration: manifest.dataGeneration,
        exportedAtMs: manifest.exportedAtMs,
      },
      events,
      snapshots: parsed.snapshots as ExportSnapshotRow[],
      receipts,
    },
  }
}

/** Restore fence: max id + fixed margin, clamped to the signed 64-bit maximum. */
export function restoreFenceNextId(maxId: string, margin: number = EXPORT_RESTORE_FENCE_MARGIN): string {
  if (!isDecimalEventId(maxId)) throw new Error('invalid_event_id')
  const next = BigInt(maxId) + BigInt(margin)
  return (next > SIGNED_64_MAX ? SIGNED_64_MAX : next).toString()
}
