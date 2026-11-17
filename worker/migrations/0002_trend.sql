-- #116 public trend cache. Section payloads are public JSON; no usage envelope or credentials.
CREATE TABLE trend_section (
  section        TEXT NOT NULL PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  generated_at   INTEGER NOT NULL,
  payload        TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  CHECK (typeof(schema_version) = 'integer' AND schema_version > 0),
  CHECK (typeof(generated_at) = 'integer'),
  CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TABLE trend_source_state (
  source      TEXT NOT NULL PRIMARY KEY,
  etag        TEXT,
  fetched_at  INTEGER NOT NULL,
  ok          INTEGER NOT NULL,
  http_status INTEGER,
  CHECK (typeof(fetched_at) = 'integer'),
  CHECK (ok IN (0, 1)),
  CHECK (http_status IS NULL OR typeof(http_status) = 'integer')
) STRICT;

CREATE TABLE trend_model_seen (
  canonical_id  TEXT NOT NULL PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  release_date  TEXT,
  source        TEXT NOT NULL,
  CHECK (length(canonical_id) > 0),
  CHECK (typeof(first_seen_at) = 'integer')
) STRICT;
