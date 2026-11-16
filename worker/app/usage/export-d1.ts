/**
 * ADR 0.10 §6.1 scheduled export orchestration.
 * Pure orchestration over injected D1/R2 ports; the composition root supplies bindings.
 */
import {
  EXPORT_EVENT_PAGE_MAX_BYTES,
  EXPORT_EVENT_PAGE_MAX_ROWS,
  EXPORT_EVENT_PAGE_ROWS,
  EXPORT_PART_MAX_BYTES,
  EXPORT_RECEIPT_PAGE_MAX_ROWS,
  buildExportDocument,
  chunkRowsByEncodedBytes,
  classifyScheduledCron,
  compareDecimalIds,
  exportObjectKey,
  jsonByteLength,
  parseDataGeneration,
  serializeExportDocument,
} from '../../domain/usage/export'
import type {
  ExportEventRow,
  ExportReceiptRow,
  ExportSink,
  ExportSnapshotRow,
  ExportSource,
  ReceiptCursor,
} from '../../domain/usage/export'

export type ExportRunFailureReason =
  | 'export_write_failed'
  | 'export_log_failed'
  | 'export_row_too_large'
  | 'export_cursor_stalled'

export type ExportRunResult =
  | { ok: true; value: { parts: number; eventHighWaterId: string; receiptCutMs: number; bytes: number } }
  | { ok: false; reason: ExportRunFailureReason }

export type ScheduledExportResult =
  | { ok: true; kind: 'skipped'; reason: 'not_export' | 'missing_bindings' | 'invalid_data_generation' }
  | { ok: true; kind: 'exported'; parts: number; eventHighWaterId: string; receiptCutMs: number; bytes: number }
  | { ok: false; reason: ExportRunFailureReason }

export interface RunD1ExportInput {
  source: ExportSource
  sink: ExportSink
  nowMs: number
  dataGeneration: number
  eventPageMaxRows?: number
  eventPageMaxBytes?: number
  receiptPageMaxRows?: number
  partMaxBytes?: number
}

interface PartRows {
  events?: readonly ExportEventRow[]
  snapshots?: readonly ExportSnapshotRow[]
  receipts?: readonly ExportReceiptRow[]
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(value)))
const PART_OVERHEAD_BYTES = 1024

/**
 * Export one incremental run. A part is written and logged before the next one,
 * so a failure never advances the high-water past an object that is not durable.
 */
export async function runD1Export(input: RunD1ExportInput): Promise<ExportRunResult> {
  const eventPageMaxRows = clamp(input.eventPageMaxRows ?? EXPORT_EVENT_PAGE_ROWS, 1, EXPORT_EVENT_PAGE_ROWS)
  const eventPageMaxBytes = input.eventPageMaxBytes ?? EXPORT_EVENT_PAGE_MAX_BYTES
  const receiptPageMaxRows = clamp(input.receiptPageMaxRows ?? EXPORT_RECEIPT_PAGE_MAX_ROWS, 1, EXPORT_RECEIPT_PAGE_MAX_ROWS)
  const partMaxBytes = clamp(input.partMaxBytes ?? EXPORT_PART_MAX_BYTES, 1, Number.MAX_SAFE_INTEGER)
  const chunkBudget = Math.max(1, partMaxBytes - PART_OVERHEAD_BYTES)

  const dateKey = exportObjectKey(input.nowMs, 1).slice(0, 10)
  const lastLog = await input.source.readLastOkLog(input.dataGeneration)
  let highWaterId = lastLog?.eventHighWaterId ?? '0'
  let receiptCutMs = lastLog?.receiptCutMs ?? 0
  let part = (await input.source.readLastPartNumber(dateKey)) + 1
  let parts = 0
  let bytes = 0

  const writePart = async (rows: PartRows, nextHighWaterId: string, nextReceiptCutMs: number): Promise<ExportRunResult | { ok: true }> => {
    const document = buildExportDocument({
      part,
      manifest: {
        eventHighWaterId: nextHighWaterId,
        receiptCutMs: nextReceiptCutMs,
        dataGeneration: input.dataGeneration,
        exportedAtMs: input.nowMs,
      },
      events: rows.events ?? [],
      snapshots: rows.snapshots ?? [],
      receipts: rows.receipts ?? [],
    })
    const body = serializeExportDocument(document)
    if (jsonByteLength(body) > partMaxBytes) return { ok: false, reason: 'export_row_too_large' }
    const objectKey = exportObjectKey(input.nowMs, part)
    let written: number
    try {
      written = await input.sink.putObject(objectKey, body)
    } catch {
      try {
        await input.source.appendLog({
          ranAtMs: input.nowMs,
          objectKey,
          eventHighWaterId: nextHighWaterId,
          receiptCutMs: nextReceiptCutMs,
          dataGeneration: input.dataGeneration,
          bytes: 0,
          ok: 0,
        })
      } catch {
        // The failed part is still not committed; a later run retries from the last ok log.
      }
      return { ok: false, reason: 'export_write_failed' }
    }
    try {
      await input.source.appendLog({
        ranAtMs: input.nowMs,
        objectKey,
        eventHighWaterId: nextHighWaterId,
        receiptCutMs: nextReceiptCutMs,
        dataGeneration: input.dataGeneration,
        bytes: written,
        ok: 1,
      })
    } catch {
      return { ok: false, reason: 'export_log_failed' }
    }
    part += 1
    parts += 1
    bytes += written
    return { ok: true }
  }

  while (true) {
    const events = await input.source.readEventPage(highWaterId, eventPageMaxRows, eventPageMaxBytes)
    if (events.length === 0) break
    const pageHighWaterId = events[events.length - 1]!.id
    if (compareDecimalIds(events[0]!.id, highWaterId) <= 0 || compareDecimalIds(pageHighWaterId, highWaterId) <= 0) {
      return { ok: false, reason: 'export_cursor_stalled' }
    }
    for (const chunk of chunkRowsByEncodedBytes(events, chunkBudget)) {
      const result = await writePart({ events: chunk }, chunk[chunk.length - 1]!.id, receiptCutMs)
      if (!result.ok) return result
    }
    highWaterId = pageHighWaterId
  }

  const snapshots = await input.source.readSnapshots()
  if (snapshots.length > 0) {
    for (const chunk of chunkRowsByEncodedBytes(snapshots, chunkBudget)) {
      const result = await writePart({ snapshots: chunk }, highWaterId, receiptCutMs)
      if (!result.ok) return result
    }
  }

  let cursor: ReceiptCursor = { createdAtMs: receiptCutMs, operationId: null }
  let lastReceiptMs: number | null = null
  while (true) {
    const receipts = await input.source.readReceiptPage(cursor, receiptPageMaxRows)
    if (receipts.length === 0) break
    const last = receipts[receipts.length - 1]!
    lastReceiptMs = last.createdAtMs
    const nextCut = receipts.length < receiptPageMaxRows
      ? Math.min(Number.MAX_SAFE_INTEGER, last.createdAtMs + 1)
      : last.createdAtMs
    const result = await writePart({ receipts }, highWaterId, nextCut)
    if (!result.ok) return result
    receiptCutMs = Math.max(receiptCutMs, nextCut)
    cursor = { createdAtMs: last.createdAtMs, operationId: last.operationId }
  }
  // A full final page is followed by an empty query. Persist the exclusive cut in a
  // small manifest-only object so the next run does not re-export that millisecond.
  if (lastReceiptMs !== null && receiptCutMs <= lastReceiptMs) {
    receiptCutMs = Math.min(Number.MAX_SAFE_INTEGER, lastReceiptMs + 1)
    const result = await writePart({}, highWaterId, receiptCutMs)
    if (!result.ok) return result
  }

  if (parts === 0) {
    const result = await writePart({}, highWaterId, receiptCutMs)
    if (!result.ok) return result
  }

  return { ok: true, value: { parts, eventHighWaterId: highWaterId, receiptCutMs, bytes } }
}

export async function runScheduledExport(input: {
  cron: string | undefined
  source: ExportSource | null
  sink: ExportSink | null
  nowMs: number
  dataGeneration: string | undefined
}): Promise<ScheduledExportResult> {
  if (classifyScheduledCron(input.cron) !== 'export') return { ok: true, kind: 'skipped', reason: 'not_export' }
  const dataGeneration = parseDataGeneration(input.dataGeneration)
  if (dataGeneration === null) return { ok: true, kind: 'skipped', reason: 'invalid_data_generation' }
  if (input.source === null || input.sink === null) return { ok: true, kind: 'skipped', reason: 'missing_bindings' }

  const result = await runD1Export({
    source: input.source,
    sink: input.sink,
    nowMs: input.nowMs,
    dataGeneration,
  })
  return result.ok ? { ok: true, kind: 'exported', ...result.value } : result
}
