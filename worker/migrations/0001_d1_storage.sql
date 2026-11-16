-- D1 storage schema (ADR 0.10 §4). This file is the SQL source of truth.
-- D1 applies it with `wrangler d1 migrations apply`; runtime code never migrates.

CREATE TABLE usage_snapshot (
  provider TEXT NOT NULL PRIMARY KEY,
  envelope TEXT NOT NULL,
  status TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  fetched_at INTEGER,
  raw_sha256 TEXT,
  collector_version TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  write_seq INTEGER NOT NULL DEFAULT 0,
  operation_id TEXT,
  CHECK (json_valid(envelope) AND json_type(envelope) = 'object'),
  CHECK (typeof(run_at) = 'integer'),
  CHECK (fetched_at IS NULL OR typeof(fetched_at) = 'integer'),
  CHECK (typeof(updated_at) = 'integer'),
  CHECK (typeof(write_seq) = 'integer' AND write_seq >= 0),
  CHECK (operation_id IS NULL OR length(operation_id) > 0)
) STRICT;

CREATE TABLE usage_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  raw_sha256 TEXT,
  envelope TEXT NOT NULL,
  operation_id TEXT,
  CHECK (typeof(id) = 'integer'),
  CHECK (typeof(run_at) = 'integer'),
  CHECK (json_valid(envelope) AND json_type(envelope) = 'object'),
  CHECK (operation_id IS NULL OR length(operation_id) > 0),
  UNIQUE (operation_id)
) STRICT;

CREATE INDEX usage_event_provider_run_at
  ON usage_event (provider, run_at, id);

CREATE TABLE usage_write_receipt (
  operation_id TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  write_seq INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  CHECK (length(operation_id) > 0),
  CHECK (typeof(write_seq) = 'integer' AND write_seq > 0),
  CHECK (typeof(created_at_ms) = 'integer'),
  CHECK (length(payload_sha256) > 0),
  UNIQUE (provider, write_seq)
) STRICT;

CREATE INDEX usage_write_receipt_created_at
  ON usage_write_receipt (created_at_ms);

CREATE TABLE usage_bucket_checkpoint (
  provider TEXT NOT NULL,
  scan_version INTEGER NOT NULL,
  data_generation INTEGER NOT NULL,
  last_processed_id TEXT NOT NULL,
  stalled_at_ms INTEGER,
  PRIMARY KEY (provider, scan_version, data_generation),
  CHECK (typeof(scan_version) = 'integer'),
  CHECK (typeof(data_generation) = 'integer'),
  CHECK (typeof(stalled_at_ms) = 'integer' OR stalled_at_ms IS NULL),
  CHECK (length(last_processed_id) > 0),
  CHECK (last_processed_id NOT GLOB '*[^0-9]*'),
  CHECK (last_processed_id = '0' OR last_processed_id NOT GLOB '0*')
) STRICT;

CREATE TABLE usage_bucket_boundary (
  provider TEXT NOT NULL,
  scan_version INTEGER NOT NULL,
  data_generation INTEGER NOT NULL,
  row_kind TEXT NOT NULL,
  bucket_start_ms INTEGER,
  source_event_id TEXT,
  run_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  envelope TEXT NOT NULL,
  CHECK (row_kind IN ('flat', 'point')),
  CHECK (typeof(scan_version) = 'integer'),
  CHECK (typeof(data_generation) = 'integer'),
  CHECK (bucket_start_ms IS NULL OR typeof(bucket_start_ms) = 'integer'),
  CHECK (source_event_id IS NULL OR typeof(source_event_id) = 'text'),
  CHECK (typeof(run_at_ms) = 'integer'),
  CHECK (json_valid(envelope) AND json_type(envelope) = 'object'),
  CHECK (
    (row_kind = 'flat' AND bucket_start_ms IS NOT NULL AND source_event_id IS NULL)
    OR
    (row_kind = 'point' AND bucket_start_ms IS NULL AND source_event_id IS NOT NULL)
  ),
  CHECK (source_event_id IS NULL OR (length(source_event_id) > 0 AND source_event_id NOT GLOB '*[^0-9]*' AND (source_event_id = '0' OR source_event_id NOT GLOB '0*')))
) STRICT;

CREATE UNIQUE INDEX usage_bucket_boundary_flat
  ON usage_bucket_boundary (provider, scan_version, data_generation, bucket_start_ms)
  WHERE row_kind = 'flat';

CREATE UNIQUE INDEX usage_bucket_boundary_point
  ON usage_bucket_boundary (provider, scan_version, data_generation, source_event_id)
  WHERE row_kind = 'point';

CREATE TABLE usage_export_log (
  ran_at_ms INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  event_high_water_id TEXT NOT NULL,
  receipt_cut_ms INTEGER NOT NULL,
  data_generation INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  CHECK (typeof(ran_at_ms) = 'integer'),
  CHECK (typeof(receipt_cut_ms) = 'integer'),
  CHECK (typeof(data_generation) = 'integer'),
  CHECK (typeof(bytes) = 'integer' AND bytes >= 0),
  CHECK (typeof(ok) = 'integer' AND ok IN (0, 1)),
  CHECK (length(event_high_water_id) > 0 AND event_high_water_id NOT GLOB '*[^0-9]*' AND (event_high_water_id = '0' OR event_high_water_id NOT GLOB '0*'))
) STRICT;
