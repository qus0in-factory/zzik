/**
 * ADR 0.10 §6.2 restore foundation: R2 export objects -> scratch D1.
 * The operator still bumps USAGE_HISTORY_SCAN_VERSION and data_generation.
 */
import { compareDecimalIds, parseExportDocument, restoreFenceNextId } from '../../domain/usage/export'
import type { ExportDocument, ExportObjectReader, RestoreTarget } from '../../domain/usage/export'

export type RestoreResult =
  | {
    ok: true
    value: {
      documents: number
      events: number
      snapshots: number
      receipts: number
      maxEventId: string | null
      nextIdFence: string | null
      requiresScanVersionBump: true
    }
  }
  | { ok: false; reason: 'invalid_export_object' | 'export_object_missing' | 'export_restore_conflict' | 'export_restore_failed' | 'generation_not_found' }

function failureReason(error: unknown): RestoreResult {
  const message = error instanceof Error ? error.message : ''
  return { ok: false, reason: message === 'export_restore_conflict' ? 'export_restore_conflict' : 'export_restore_failed' }
}

/**
 * Read all objects, sort by event high-water, then insert explicit ids.
 * A repeated identical row is skipped; a conflicting row aborts before the fence.
 */
export async function restoreFromExportObjects(
  reader: ExportObjectReader,
  target: RestoreTarget,
  options: { prefix?: string; dataGeneration?: number } = {},
): Promise<RestoreResult> {
  const keys = (await reader.list(options.prefix)).sort()
  const allDocuments: ExportDocument[] = []
  for (const key of keys) {
    const text = await reader.read(key)
    if (text === null) return { ok: false, reason: 'export_object_missing' }
    const parsed = parseExportDocument(text)
    if (!parsed.ok) return { ok: false, reason: 'invalid_export_object' }
    allDocuments.push(parsed.value)
  }
  const generation = options.dataGeneration
    ?? (allDocuments.length === 0 ? null : Math.max(...allDocuments.map(document => document.manifest.dataGeneration)))
  const documents = generation === null
    ? allDocuments
    : allDocuments.filter(document => document.manifest.dataGeneration === generation)
  if (options.dataGeneration !== undefined && documents.length === 0) return { ok: false, reason: 'generation_not_found' }
  documents.sort((left, right) => {
    const highWater = compareDecimalIds(left.manifest.eventHighWaterId, right.manifest.eventHighWaterId)
    if (highWater !== 0) return highWater
    if (left.manifest.exportedAtMs !== right.manifest.exportedAtMs) {
      return left.manifest.exportedAtMs < right.manifest.exportedAtMs ? -1 : 1
    }
    return left.part - right.part
  })

  let events = 0
  let snapshots = 0
  let receipts = 0
  let maxEventId: string | null = null

  try {
    for (const document of documents) {
      if (document.manifest.eventHighWaterId !== '0'
        && (maxEventId === null || compareDecimalIds(document.manifest.eventHighWaterId, maxEventId) > 0)) {
        maxEventId = document.manifest.eventHighWaterId
      }
      for (const row of document.events) {
        if (maxEventId === null || compareDecimalIds(row.id, maxEventId) > 0) maxEventId = row.id
        const result = await target.insertEvent(row)
        if (result === 'inserted') events += 1
      }
      for (const row of document.snapshots) {
        await target.upsertSnapshot(row)
        snapshots += 1
      }
      for (const row of document.receipts) {
        const result = await target.insertReceipt(row)
        if (result === 'inserted') receipts += 1
      }
    }
    const nextIdFence = maxEventId === null ? null : restoreFenceNextId(maxEventId)
    if (nextIdFence !== null) await target.fenceSequence(nextIdFence)
    return {
      ok: true,
      value: { documents: documents.length, events, snapshots, receipts, maxEventId, nextIdFence, requiresScanVersionBump: true },
    }
  } catch (error) {
    return failureReason(error)
  }
}
