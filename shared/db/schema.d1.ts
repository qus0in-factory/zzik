import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** D1 schema mirror of worker/migrations/0001_d1_storage.sql (ADR 0.10 §4). */
export const usageSnapshot = sqliteTable('usage_snapshot', {
  provider: text('provider').primaryKey(),
  envelope: text('envelope').notNull(),
  status: text('status').notNull(),
  runAt: integer('run_at').notNull(),
  fetchedAt: integer('fetched_at'),
  rawSha256: text('raw_sha256'),
  collectorVersion: text('collector_version').notNull(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  writeSeq: integer('write_seq').notNull().default(0),
  operationId: text('operation_id'),
}, table => [
  check('usage_snapshot_envelope_object', sql`json_valid(${table.envelope}) AND json_type(${table.envelope}) = 'object'`),
  check('usage_snapshot_run_at_integer', sql`typeof(${table.runAt}) = 'integer'`),
  check('usage_snapshot_fetched_at_integer', sql`${table.fetchedAt} IS NULL OR typeof(${table.fetchedAt}) = 'integer'`),
  check('usage_snapshot_updated_at_integer', sql`typeof(${table.updatedAt}) = 'integer'`),
  check('usage_snapshot_write_seq_integer', sql`typeof(${table.writeSeq}) = 'integer' AND ${table.writeSeq} >= 0`),
  check('usage_snapshot_operation_nonempty', sql`${table.operationId} IS NULL OR length(${table.operationId}) > 0`),
])

export const usageEvent = sqliteTable('usage_event', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  runAt: integer('run_at').notNull(),
  status: text('status').notNull(),
  rawSha256: text('raw_sha256'),
  envelope: text('envelope').notNull(),
  operationId: text('operation_id'),
}, table => [
  index('usage_event_provider_run_at').on(table.provider, table.runAt, table.id),
  unique('usage_event_operation_id').on(table.operationId),
  check('usage_event_id_integer', sql`typeof(${table.id}) = 'integer'`),
  check('usage_event_run_at_integer', sql`typeof(${table.runAt}) = 'integer'`),
  check('usage_event_envelope_object', sql`json_valid(${table.envelope}) AND json_type(${table.envelope}) = 'object'`),
  check('usage_event_operation_nonempty', sql`${table.operationId} IS NULL OR length(${table.operationId}) > 0`),
])

export const usageWriteReceipt = sqliteTable('usage_write_receipt', {
  operationId: text('operation_id').notNull(),
  provider: text('provider').notNull(),
  writeSeq: integer('write_seq').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, table => [
  primaryKey({ columns: [table.operationId] }),
  unique('usage_write_receipt_provider_write_seq').on(table.provider, table.writeSeq),
  index('usage_write_receipt_created_at').on(table.createdAtMs),
  check('usage_write_receipt_operation_nonempty', sql`length(${table.operationId}) > 0`),
  check('usage_write_receipt_write_seq_integer', sql`typeof(${table.writeSeq}) = 'integer' AND ${table.writeSeq} > 0`),
  check('usage_write_receipt_created_at_integer', sql`typeof(${table.createdAtMs}) = 'integer'`),
  check('usage_write_receipt_payload_sha256_nonempty', sql`length(${table.payloadSha256}) > 0`),
])

export const usageBucketCheckpoint = sqliteTable('usage_bucket_checkpoint', {
  provider: text('provider').notNull(),
  scanVersion: integer('scan_version').notNull(),
  dataGeneration: integer('data_generation').notNull(),
  lastProcessedId: text('last_processed_id').notNull(),
  stalledAtMs: integer('stalled_at_ms'),
}, table => [
  primaryKey({ columns: [table.provider, table.scanVersion, table.dataGeneration] }),
  check('usage_bucket_checkpoint_scan_version_integer', sql`typeof(${table.scanVersion}) = 'integer'`),
  check('usage_bucket_checkpoint_data_generation_integer', sql`typeof(${table.dataGeneration}) = 'integer'`),
  check('usage_bucket_checkpoint_stalled_at_integer', sql`${table.stalledAtMs} IS NULL OR typeof(${table.stalledAtMs}) = 'integer'`),
  check('usage_bucket_checkpoint_last_processed_nonempty', sql`length(${table.lastProcessedId}) > 0`),
  check('usage_bucket_checkpoint_last_processed_decimal', sql`${table.lastProcessedId} NOT GLOB '*[^0-9]*'`),
  check('usage_bucket_checkpoint_last_processed_normalized', sql`${table.lastProcessedId} = '0' OR ${table.lastProcessedId} NOT GLOB '0*'`),
])

export const usageBucketBoundary = sqliteTable('usage_bucket_boundary', {
  provider: text('provider').notNull(),
  scanVersion: integer('scan_version').notNull(),
  dataGeneration: integer('data_generation').notNull(),
  rowKind: text('row_kind').notNull(),
  bucketStartMs: integer('bucket_start_ms'),
  sourceEventId: text('source_event_id'),
  runAtMs: integer('run_at_ms').notNull(),
  status: text('status').notNull(),
  envelope: text('envelope').notNull(),
}, table => [
  uniqueIndex('usage_bucket_boundary_flat').on(table.provider, table.scanVersion, table.dataGeneration, table.bucketStartMs).where(sql`row_kind = 'flat'`),
  uniqueIndex('usage_bucket_boundary_point').on(table.provider, table.scanVersion, table.dataGeneration, table.sourceEventId).where(sql`row_kind = 'point'`),
  check('usage_bucket_boundary_row_kind', sql`${table.rowKind} IN ('flat', 'point')`),
  check('usage_bucket_boundary_scan_version_integer', sql`typeof(${table.scanVersion}) = 'integer'`),
  check('usage_bucket_boundary_data_generation_integer', sql`typeof(${table.dataGeneration}) = 'integer'`),
  check('usage_bucket_boundary_bucket_start_integer', sql`${table.bucketStartMs} IS NULL OR typeof(${table.bucketStartMs}) = 'integer'`),
  check('usage_bucket_boundary_source_event_text', sql`${table.sourceEventId} IS NULL OR typeof(${table.sourceEventId}) = 'text'`),
  check('usage_bucket_boundary_run_at_integer', sql`typeof(${table.runAtMs}) = 'integer'`),
  check('usage_bucket_boundary_envelope_object', sql`json_valid(${table.envelope}) AND json_type(${table.envelope}) = 'object'`),
  check('usage_bucket_boundary_key_shape', sql`(${table.rowKind} = 'flat' AND ${table.bucketStartMs} IS NOT NULL AND ${table.sourceEventId} IS NULL) OR (${table.rowKind} = 'point' AND ${table.bucketStartMs} IS NULL AND ${table.sourceEventId} IS NOT NULL)`),
  check('usage_bucket_boundary_source_event_decimal', sql`${table.sourceEventId} IS NULL OR (length(${table.sourceEventId}) > 0 AND ${table.sourceEventId} NOT GLOB '*[^0-9]*' AND (${table.sourceEventId} = '0' OR ${table.sourceEventId} NOT GLOB '0*'))`),
])

export const usageExportLog = sqliteTable('usage_export_log', {
  ranAtMs: integer('ran_at_ms').notNull(),
  objectKey: text('object_key').notNull(),
  eventHighWaterId: text('event_high_water_id').notNull(),
  receiptCutMs: integer('receipt_cut_ms').notNull(),
  dataGeneration: integer('data_generation').notNull(),
  bytes: integer('bytes').notNull(),
  ok: integer('ok').notNull(),
}, table => [
  check('usage_export_log_ran_at_integer', sql`typeof(${table.ranAtMs}) = 'integer'`),
  check('usage_export_log_receipt_cut_integer', sql`typeof(${table.receiptCutMs}) = 'integer'`),
  check('usage_export_log_data_generation_integer', sql`typeof(${table.dataGeneration}) = 'integer'`),
  check('usage_export_log_bytes_integer', sql`typeof(${table.bytes}) = 'integer' AND ${table.bytes} >= 0`),
  check('usage_export_log_ok_integer', sql`typeof(${table.ok}) = 'integer' AND ${table.ok} IN (0, 1)`),
  check('usage_export_log_high_water_decimal', sql`length(${table.eventHighWaterId}) > 0 AND ${table.eventHighWaterId} NOT GLOB '*[^0-9]*' AND (${table.eventHighWaterId} = '0' OR ${table.eventHighWaterId} NOT GLOB '0*')`),
])
