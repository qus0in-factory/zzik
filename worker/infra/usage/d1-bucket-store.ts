/**
 * ADR 0.10 §7 D1 bucket adapters.
 * The request path only reads boundary/checkpoint tables; the 15-minute cron writes them.
 */
import { USAGE_BUCKET_MAX_POINTS, USAGE_BUCKET_READ_BUDGET_MS, USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract'
import type { UsageHistoryBucketsPage, UsageHistoryBucketsQuery, UsageHistorySample } from '../../../shared/usage-history-contract'
import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract'
import { truncateBucketSamples } from '../../domain/usage/bucket'
import type { BucketCheckpoint, BucketEvent, BucketStore, BucketWritePageInput, BucketWriterStore } from '../../domain/usage/bucket-store'
import { historySample } from '../../domain/usage/history-sample'
import type { HistoryResult } from '../../domain/usage/history-store'
import { D1HistoryStore } from './d1-history-store'
import type { D1DatabaseLike, D1PreparedStatementLike } from './d1-history-store'

interface D1BatchDatabaseLike extends D1DatabaseLike {
  batch?(statements: D1PreparedStatementLike[]): Promise<Array<{ success?: boolean }>>
}

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

interface EventDbRow {
  id: string
  runAtMs: number
  status: string
  envelope: string
}

interface BoundaryDbRow {
  bucketStartMs?: number
  sourceEventId?: string | null
  runAtMs: number
  status: string
  envelope: string
}

interface CheckpointDbRow {
  lastProcessedId: string
  stalledAtMs: number | null
}

function recordOf(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sampleOf(provider: UsageProvider, row: { runAtMs: number; status: string; envelope: string }, id: string): UsageHistorySample {
  const envelope = recordOf(row.envelope)
  return historySample(provider, {
    id,
    runAt: new Date(row.runAtMs).toISOString(),
    status: row.status as UsageStatus,
    fetchedAt: typeof envelope.fetchedAt === 'string' ? envelope.fetchedAt : null,
    intervalSec: typeof envelope.intervalSec === 'number' ? String(envelope.intervalSec) : null,
    rawText: row.status === 'ok' && typeof envelope.rawText === 'string' ? envelope.rawText : null,
    rawRedacted: envelope.rawRedacted ?? null,
  })
}

function eventOf(provider: UsageProvider, row: EventDbRow): BucketEvent {
  return { sample: sampleOf(provider, row, row.id), envelope: row.envelope }
}

export interface D1BucketOptions {
  dataGeneration?: number
  now?: () => number
  maxPoints?: number
  budgetMs?: number
}

export class D1BucketStore implements BucketStore {
  private readonly history: D1HistoryStore
  private readonly dataGeneration: number
  private readonly now: () => number
  private readonly maxPoints: number
  private readonly budgetMs: number

  constructor(private readonly db: D1DatabaseLike, options: D1BucketOptions = {}) {
    this.history = new D1HistoryStore(db)
    this.dataGeneration = options.dataGeneration ?? 0
    this.now = options.now ?? (() => Date.now())
    this.maxPoints = options.maxPoints ?? USAGE_BUCKET_MAX_POINTS
    this.budgetMs = options.budgetMs ?? USAGE_BUCKET_READ_BUDGET_MS
  }

  async readBuckets(provider: UsageProvider, query: UsageHistoryBucketsQuery): Promise<HistoryResult<UsageHistoryBucketsPage>> {
    const started = this.now()
    const anchor = await this.history.readAnchorRow(provider, query.from)
    if (!anchor.ok) return anchor
    const fromMs = Date.parse(query.from)
    const untilMs = Date.parse(query.until)
    try {
      const flats = await all<BoundaryDbRow>(
        this.db,
        `SELECT bucket_start_ms AS bucketStartMs, run_at_ms AS runAtMs, status, envelope
           FROM usage_bucket_boundary
          WHERE provider = ? AND scan_version = ? AND data_generation = ?
            AND row_kind = 'flat' AND bucket_start_ms >= ? AND bucket_start_ms < ?`,
        [provider, USAGE_HISTORY_SCAN_VERSION, this.dataGeneration, fromMs, untilMs],
      )
      const points = await all<BoundaryDbRow>(
        this.db,
        `SELECT source_event_id AS sourceEventId, run_at_ms AS runAtMs, status, envelope
           FROM usage_bucket_boundary
          WHERE provider = ? AND scan_version = ? AND data_generation = ?
            AND row_kind = 'point' AND run_at_ms >= ? AND run_at_ms < ?
          ORDER BY run_at_ms ASC, CAST(source_event_id AS INTEGER) ASC`,
        [provider, USAGE_HISTORY_SCAN_VERSION, this.dataGeneration, fromMs, untilMs],
      )
      const samples: UsageHistorySample[] = []
      for (const row of flats) {
        if (row.runAtMs >= fromMs && row.runAtMs < untilMs) samples.push(sampleOf(provider, row, `flat:${row.bucketStartMs}`))
      }
      for (const row of points) samples.push(sampleOf(provider, row, row.sourceEventId ?? ''))
      const truncated = truncateBucketSamples(samples, this.maxPoints)
      return {
        ok: true,
        value: {
          provider,
          scanVersion: USAGE_HISTORY_SCAN_VERSION,
          bucketSec: query.bucketSec,
          from: query.from,
          until: query.until,
          samples: truncated.samples,
          anchor: anchor.value === null ? null : historySample(provider, anchor.value),
          complete: truncated.complete && this.now() - started <= this.budgetMs,
        },
      }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }
}

export class D1BucketWriterStore implements BucketWriterStore {
  constructor(private readonly db: D1BatchDatabaseLike) {}

  async readCheckpoint(provider: UsageProvider, scanVersion: number, dataGeneration: number): Promise<BucketCheckpoint | null> {
    const rows = await all<CheckpointDbRow>(
      this.db,
      `SELECT last_processed_id AS lastProcessedId, stalled_at_ms AS stalledAtMs
         FROM usage_bucket_checkpoint
        WHERE provider = ? AND scan_version = ? AND data_generation = ?`,
      [provider, scanVersion, dataGeneration],
    )
    return rows[0] ?? null
  }

  async readEventById(provider: UsageProvider, id: string): Promise<BucketEvent | null> {
    const rows = await all<EventDbRow & { provider: string }>(
      this.db,
      `SELECT CAST(e.id AS TEXT) AS id, e.provider, e.run_at AS runAtMs, e.status, e.envelope
         FROM usage_event AS e WHERE e.provider = ? AND e.id = CAST(? AS INTEGER)`,
      [provider, id],
    )
    const row = rows[0]
    return row === undefined ? null : eventOf(row.provider as UsageProvider, row)
  }

  async readEventPageAfter(provider: UsageProvider, afterId: string, limit: number): Promise<BucketEvent[]> {
    const rows = await all<EventDbRow & { provider: string }>(
      this.db,
      `SELECT CAST(e.id AS TEXT) AS id, e.provider, e.run_at AS runAtMs, e.status, e.envelope
         FROM usage_event AS e WHERE e.provider = ? AND e.id > CAST(? AS INTEGER)
        ORDER BY e.id ASC LIMIT ?`,
      [provider, afterId, limit],
    )
    return rows.map(row => eventOf(row.provider as UsageProvider, row))
  }

  async readFlatRepresentative(provider: UsageProvider, scanVersion: number, dataGeneration: number, bucketStartMs: number): Promise<UsageHistorySample | null> {
    const rows = await all<BoundaryDbRow>(
      this.db,
      `SELECT bucket_start_ms AS bucketStartMs, run_at_ms AS runAtMs, status, envelope
         FROM usage_bucket_boundary
        WHERE provider = ? AND scan_version = ? AND data_generation = ?
          AND row_kind = 'flat' AND bucket_start_ms = ?`,
      [provider, scanVersion, dataGeneration, bucketStartMs],
    )
    return rows[0] === undefined ? null : sampleOf(provider, rows[0], `flat:${bucketStartMs}`)
  }

  async writePage(input: BucketWritePageInput): Promise<void> {
    const statements: D1PreparedStatementLike[] = []
    for (const event of input.points) {
      statements.push(this.db.prepare(
        `INSERT INTO usage_bucket_boundary
           (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope)
         VALUES (?, ?, ?, 'point', NULL, ?, ?, ?, ?)
         ON CONFLICT(provider, scan_version, data_generation, source_event_id) WHERE row_kind = 'point' DO NOTHING`,
      ).bind(input.provider, input.scanVersion, input.dataGeneration, event.sample.id,
        Date.parse(event.sample.runAt), event.sample.status, event.envelope))
    }
    for (const flat of input.flats) {
      statements.push(this.db.prepare(
        `INSERT INTO usage_bucket_boundary
           (provider, scan_version, data_generation, row_kind, bucket_start_ms, source_event_id, run_at_ms, status, envelope)
         VALUES (?, ?, ?, 'flat', ?, NULL, ?, ?, ?)
         ON CONFLICT(provider, scan_version, data_generation, bucket_start_ms) WHERE row_kind = 'flat'
         DO UPDATE SET run_at_ms = excluded.run_at_ms, status = excluded.status, envelope = excluded.envelope
         WHERE excluded.run_at_ms >= usage_bucket_boundary.run_at_ms`,
      ).bind(input.provider, input.scanVersion, input.dataGeneration, flat.bucketStartMs,
        Date.parse(flat.event.sample.runAt), flat.event.sample.status, flat.event.envelope))
    }
    statements.push(this.db.prepare(
      `INSERT INTO usage_bucket_checkpoint
         (provider, scan_version, data_generation, last_processed_id, stalled_at_ms)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(provider, scan_version, data_generation) DO UPDATE SET
         last_processed_id = excluded.last_processed_id,
         stalled_at_ms = NULL
       WHERE CAST(usage_bucket_checkpoint.last_processed_id AS INTEGER) < CAST(excluded.last_processed_id AS INTEGER)`,
    ).bind(input.provider, input.scanVersion, input.dataGeneration, input.lastProcessedId))

    if (this.db.batch !== undefined) {
      const results = await this.db.batch(statements)
      if (results.some(result => result.success === false)) throw new Error('D1 batch failed')
    } else {
      for (const statement of statements) await statement.run()
    }
  }

  async stall(provider: UsageProvider, scanVersion: number, dataGeneration: number, stalledAtMs: number): Promise<void> {
    await this.db.prepare(
      `INSERT INTO usage_bucket_checkpoint
         (provider, scan_version, data_generation, last_processed_id, stalled_at_ms)
       VALUES (?, ?, ?, '0', ?)
       ON CONFLICT(provider, scan_version, data_generation) DO UPDATE SET stalled_at_ms = excluded.stalled_at_ms`,
    ).bind(provider, scanVersion, dataGeneration, stalledAtMs).run()
  }
}
