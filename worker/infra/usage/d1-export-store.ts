/**
 * ADR 0.10 §6.1/§6.2 D1 adapters for scheduled export and scratch restore.
 * Structural D1 only; the composition root supplies the binding.
 */
import { partNumberFromObjectKey } from '../../domain/usage/export'
import type {
  ExportEventRow,
  ExportLogRow,
  ExportReceiptRow,
  ExportSnapshotRow,
  ExportSource,
  ReceiptCursor,
  RestoreTarget,
} from '../../domain/usage/export'
import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract'
import type { D1DatabaseLike } from './d1-history-store'

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

async function run(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<void> {
  await db.prepare(query).bind(...params).run()
}

interface EventRow {
  id: string
  provider: string
  runAtMs: number
  status: string
  rawSha256: string | null
  envelope: string
  operationId: string | null
}

interface SnapshotRow extends Omit<ExportSnapshotRow, 'provider' | 'status'> {
  provider: string
  status: string
}

interface ReceiptRow {
  operationId: string
  provider: string
  writeSeq: number
  payloadSha256: string
  createdAtMs: number
}

interface LogRow {
  ranAtMs: number
  objectKey: string
  eventHighWaterId: string
  receiptCutMs: number
  dataGeneration: number
  bytes: number
  ok: number
}

export class D1ExportSource implements ExportSource {
  constructor(private readonly db: D1DatabaseLike) {}

  async readLastOkLog(dataGeneration: number): Promise<ExportLogRow | null> {
    const rows = await all<LogRow>(
      this.db,
      `SELECT ran_at_ms AS ranAtMs, object_key AS objectKey, event_high_water_id AS eventHighWaterId,
              receipt_cut_ms AS receiptCutMs, data_generation AS dataGeneration, bytes, ok
         FROM usage_export_log
        WHERE ok = 1 AND data_generation = ?
        ORDER BY ran_at_ms DESC, length(object_key) DESC, object_key DESC
        LIMIT 1`,
      [dataGeneration],
    )
    const row = rows[0]
    return row === undefined ? null : { ...row, ok: 1 }
  }

  async readEventPage(afterId: string, maxRows: number, maxBytes: number): Promise<ExportEventRow[]> {
    const rows = await all<EventRow>(
      this.db,
      `SELECT CAST(src.id AS TEXT) AS id, src.provider, src.run_at AS runAtMs, src.status,
              src.raw_sha256 AS rawSha256, src.envelope, src.operation_id AS operationId
         FROM (
           SELECT id, provider, run_at, status, raw_sha256, envelope, operation_id,
                  SUM(length(CAST(envelope AS BLOB))) OVER (ORDER BY id) AS cumulative_bytes
             FROM (
               SELECT id, provider, run_at, status, raw_sha256, envelope, operation_id
                 FROM usage_event
                WHERE id > CAST(? AS INTEGER)
                ORDER BY id ASC
                LIMIT ?
             )
         ) AS src
        WHERE src.cumulative_bytes - length(CAST(src.envelope AS BLOB)) < ?
        ORDER BY src.id ASC`,
      [afterId, maxRows, maxBytes],
    )
    return rows.map(row => ({
      ...row,
      provider: row.provider as UsageProvider,
      status: row.status as UsageStatus,
    }))
  }

  async readSnapshots(): Promise<ExportSnapshotRow[]> {
    const rows = await all<SnapshotRow>(
      this.db,
      `SELECT provider, envelope, status, run_at AS runAtMs, fetched_at AS fetchedAtMs,
              raw_sha256 AS rawSha256, collector_version AS collectorVersion, updated_at AS updatedAtMs,
              write_seq AS writeSeq, operation_id AS operationId
         FROM usage_snapshot
        ORDER BY provider ASC`,
      [],
    )
    return rows.map(row => ({
      ...row,
      provider: row.provider as UsageProvider,
      status: row.status as UsageStatus,
    }))
  }

  async readReceiptPage(cursor: ReceiptCursor, maxRows: number): Promise<ExportReceiptRow[]> {
    const rows = cursor.operationId === null
      ? await all<ReceiptRow>(
        this.db,
        `SELECT operation_id AS operationId, provider, write_seq AS writeSeq,
                payload_sha256 AS payloadSha256, created_at_ms AS createdAtMs
           FROM usage_write_receipt
          WHERE created_at_ms >= ?
          ORDER BY created_at_ms ASC, operation_id ASC
          LIMIT ?`,
        [cursor.createdAtMs, maxRows],
      )
      : await all<ReceiptRow>(
        this.db,
        `SELECT operation_id AS operationId, provider, write_seq AS writeSeq,
                payload_sha256 AS payloadSha256, created_at_ms AS createdAtMs
           FROM usage_write_receipt
          WHERE created_at_ms > ? OR (created_at_ms = ? AND operation_id > ?)
          ORDER BY created_at_ms ASC, operation_id ASC
          LIMIT ?`,
        [cursor.createdAtMs, cursor.createdAtMs, cursor.operationId, maxRows],
      )
    return rows.map(row => ({ ...row, provider: row.provider as UsageProvider }))
  }

  async readLastPartNumber(dateKey: string): Promise<number> {
    const rows = await all<{ objectKey: string }>(
      this.db,
      `SELECT object_key AS objectKey
         FROM usage_export_log
        WHERE ok = 1 AND object_key LIKE ?
        ORDER BY length(object_key) DESC, object_key DESC
        LIMIT 1`,
      [`${dateKey}/%`],
    )
    return rows[0] === undefined ? 0 : (partNumberFromObjectKey(rows[0].objectKey) ?? 0)
  }

  async appendLog(row: ExportLogRow): Promise<void> {
    await run(
      this.db,
      `INSERT INTO usage_export_log
         (ran_at_ms, object_key, event_high_water_id, receipt_cut_ms, data_generation, bytes, ok)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.ranAtMs, row.objectKey, row.eventHighWaterId, row.receiptCutMs, row.dataGeneration, row.bytes, row.ok],
    )
  }
}

export class D1RestoreTarget implements RestoreTarget {
  constructor(private readonly db: D1DatabaseLike) {}

  async insertEvent(row: ExportEventRow): Promise<'inserted' | 'skipped'> {
    const existing = await all<EventRow>(
      this.db,
      `SELECT CAST(id AS TEXT) AS id, provider, run_at AS runAtMs, status,
              raw_sha256 AS rawSha256, envelope, operation_id AS operationId
         FROM usage_event
        WHERE id = CAST(? AS INTEGER)`,
      [row.id],
    )
    const current = existing[0]
    if (current !== undefined) {
      if (current.provider !== row.provider || current.runAtMs !== row.runAtMs || current.status !== row.status
        || (current.rawSha256 ?? null) !== row.rawSha256 || current.envelope !== row.envelope) {
        throw new Error('export_restore_conflict')
      }
      return 'skipped'
    }
    await run(
      this.db,
      `INSERT INTO usage_event (id, provider, run_at, status, raw_sha256, envelope, operation_id)
       VALUES (CAST(? AS INTEGER), ?, ?, ?, ?, ?, ?)`,
      [row.id, row.provider, row.runAtMs, row.status, row.rawSha256, row.envelope, row.operationId],
    )
    return 'inserted'
  }

  async upsertSnapshot(row: ExportSnapshotRow): Promise<'inserted' | 'updated' | 'skipped'> {
    await run(
      this.db,
      `INSERT INTO usage_snapshot
         (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at, write_seq, operation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         envelope = excluded.envelope,
         status = excluded.status,
         run_at = excluded.run_at,
         fetched_at = excluded.fetched_at,
         raw_sha256 = excluded.raw_sha256,
         collector_version = excluded.collector_version,
         updated_at = excluded.updated_at,
         write_seq = excluded.write_seq,
         operation_id = excluded.operation_id`,
      [row.provider, row.envelope, row.status, row.runAtMs, row.fetchedAtMs, row.rawSha256,
        row.collectorVersion, row.updatedAtMs, row.writeSeq, row.operationId],
    )
    return 'inserted'
  }

  async insertReceipt(row: ExportReceiptRow): Promise<'inserted' | 'skipped'> {
    const existing = await all<{ payloadSha256: string }>(
      this.db,
      'SELECT payload_sha256 AS payloadSha256 FROM usage_write_receipt WHERE operation_id = ?',
      [row.operationId],
    )
    if (existing[0] !== undefined) {
      if (existing[0].payloadSha256 !== row.payloadSha256) throw new Error('export_restore_conflict')
      return 'skipped'
    }
    await run(
      this.db,
      `INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [row.operationId, row.provider, row.writeSeq, row.payloadSha256, row.createdAtMs],
    )
    return 'inserted'
  }

  async fenceSequence(nextId: string): Promise<void> {
    const maxRows = await all<{ maxId: string | null }>(this.db, 'SELECT CAST(max(id) AS TEXT) AS maxId FROM usage_event', [])
    const maxId = maxRows[0]?.maxId ?? null
    if (maxId !== null && BigInt(nextId) <= BigInt(maxId)) return
    const seq = (BigInt(nextId) - 1n).toString()
    const existing = await all<{ seq: number }>(this.db, "SELECT seq FROM sqlite_sequence WHERE name = 'usage_event'", [])
    if (existing.length === 0) {
      await run(this.db, "INSERT INTO sqlite_sequence(name, seq) VALUES ('usage_event', CAST(? AS INTEGER))", [seq])
    } else {
      await run(this.db, "UPDATE sqlite_sequence SET seq = CAST(? AS INTEGER) WHERE name = 'usage_event'", [seq])
    }
  }
}
