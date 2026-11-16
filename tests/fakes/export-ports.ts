import type {
  ExportEventRow,
  ExportLogRow,
  ExportObjectReader,
  ExportReceiptRow,
  ExportSink,
  ExportSnapshotRow,
  ExportSource,
  ReceiptCursor,
  RestoreTarget,
} from '../../worker/domain/usage/export'
import { compareDecimalIds, partNumberFromObjectKey } from '../../worker/domain/usage/export'

/** In-memory ExportSource. Pages obey the same decimal-id and byte order as the D1 adapter. */
export class FakeExportSource implements ExportSource {
  events: ExportEventRow[] = []
  snapshots: ExportSnapshotRow[] = []
  receipts: ExportReceiptRow[] = []
  lastLogs = new Map<number, ExportLogRow>()
  logs: ExportLogRow[] = []
  lastParts = new Map<string, number>()
  eventPageCalls: Array<{ afterId: string; maxRows: number; maxBytes: number }> = []

  async readLastOkLog(dataGeneration: number): Promise<ExportLogRow | null> {
    return this.lastLogs.get(dataGeneration) ?? null
  }

  async readEventPage(afterId: string, maxRows: number, maxBytes: number): Promise<ExportEventRow[]> {
    this.eventPageCalls.push({ afterId, maxRows, maxBytes })
    const rows = this.events
      .filter(row => compareDecimalIds(row.id, afterId) > 0)
      .sort((a, b) => compareDecimalIds(a.id, b.id))
      .slice(0, maxRows)
    const selected: ExportEventRow[] = []
    let bytes = 0
    for (const row of rows) {
      const rowBytes = new TextEncoder().encode(row.envelope).length
      if (selected.length > 0 && bytes + rowBytes > maxBytes) break
      selected.push(row)
      bytes += rowBytes
    }
    return selected
  }

  async readSnapshots(): Promise<ExportSnapshotRow[]> {
    return [...this.snapshots]
  }

  async readReceiptPage(cursor: ReceiptCursor, maxRows: number): Promise<ExportReceiptRow[]> {
    return this.receipts
      .filter(row => cursor.operationId === null
        ? row.createdAtMs >= cursor.createdAtMs
        : row.createdAtMs > cursor.createdAtMs
          || (row.createdAtMs === cursor.createdAtMs && row.operationId > cursor.operationId))
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.operationId.localeCompare(b.operationId))
      .slice(0, maxRows)
  }

  async readLastPartNumber(dateKey: string): Promise<number> {
    return this.lastParts.get(dateKey) ?? 0
  }

  async appendLog(row: ExportLogRow): Promise<void> {
    this.logs.push(row)
    if (row.ok === 1) {
      this.lastLogs.set(row.dataGeneration, row)
      const part = partNumberFromObjectKey(row.objectKey)
      const dateKey = row.objectKey.slice(0, 10)
      if (part !== null) this.lastParts.set(dateKey, Math.max(this.lastParts.get(dateKey) ?? 0, part))
    }
  }
}

export class FakeExportSink implements ExportSink {
  puts: Array<{ key: string; body: string; bytes: number }> = []
  failAt: number | null = null

  async putObject(key: string, body: string): Promise<number> {
    if (this.failAt !== null && this.puts.length + 1 === this.failAt) throw new Error('r2_put_failed')
    const bytes = new TextEncoder().encode(body).length
    this.puts.push({ key, body, bytes })
    return bytes
  }
}

export class FakeExportObjectReader implements ExportObjectReader {
  objects = new Map<string, string>()

  async list(prefix = ''): Promise<string[]> {
    return [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort()
  }

  async read(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null
  }
}

export class FakeRestoreTarget implements RestoreTarget {
  events = new Map<string, ExportEventRow>()
  snapshots = new Map<string, ExportSnapshotRow>()
  receipts = new Map<string, ExportReceiptRow>()
  fenced: string | null = null

  async insertEvent(row: ExportEventRow): Promise<'inserted' | 'skipped'> {
    const existing = this.events.get(row.id)
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(row)) throw new Error('export_restore_conflict')
      return 'skipped'
    }
    this.events.set(row.id, row)
    return 'inserted'
  }

  async upsertSnapshot(row: ExportSnapshotRow): Promise<'inserted' | 'updated' | 'skipped'> {
    this.snapshots.set(row.provider, row)
    return 'inserted'
  }

  async insertReceipt(row: ExportReceiptRow): Promise<'inserted' | 'skipped'> {
    const existing = this.receipts.get(row.operationId)
    if (existing !== undefined) {
      if (existing.payloadSha256 !== row.payloadSha256) throw new Error('export_restore_conflict')
      return 'skipped'
    }
    this.receipts.set(row.operationId, row)
    return 'inserted'
  }

  async fenceSequence(nextId: string): Promise<void> {
    this.fenced = nextId
  }
}
