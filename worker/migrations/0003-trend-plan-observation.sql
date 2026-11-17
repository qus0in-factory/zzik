CREATE TABLE trend_plan_observation (
  plan TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (plan, model_id)
) STRICT;
