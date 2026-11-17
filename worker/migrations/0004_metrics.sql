-- #116 metrics snapshots. Rebuildable public trend data; no usage envelope or credentials.
-- 0003 is reserved for plan-models; this migration only adds metrics tables.
CREATE TABLE trend_aa_snapshot (
  day                TEXT NOT NULL,
  slug               TEXT NOT NULL,
  name               TEXT NOT NULL,
  creator            TEXT NOT NULL,
  intelligence_index REAL NOT NULL,
  domain_json        TEXT NOT NULL,
  price_in           REAL,
  price_out          REAL,
  release_date       TEXT,
  index_version      TEXT NOT NULL,
  PRIMARY KEY (day, slug),
  CHECK (length(day) = 10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(slug) > 0),
  CHECK (typeof(intelligence_index) = 'real' OR typeof(intelligence_index) = 'integer'),
  CHECK (json_valid(domain_json) AND json_type(domain_json) = 'object'),
  CHECK (price_in IS NULL OR typeof(price_in) IN ('real', 'integer')),
  CHECK (price_out IS NULL OR typeof(price_out) IN ('real', 'integer')),
  CHECK (length(index_version) > 0)
) STRICT;

CREATE TABLE trend_or_ranking (
  day             TEXT NOT NULL,
  model_permaslug TEXT NOT NULL,
  total_tokens    TEXT NOT NULL,
  as_of           TEXT NOT NULL,
  meta_version    TEXT,
  start_date      TEXT,
  end_date        TEXT,
  PRIMARY KEY (day, model_permaslug),
  CHECK (length(day) = 10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(model_permaslug) > 0),
  CHECK (length(total_tokens) > 0 AND total_tokens NOT GLOB '*[^0-9]*')
) STRICT;
