-- #116 AA 작업당 비용(cost_per_task) 내부 저장(내부 /api/trend/aa 전용).
ALTER TABLE trend_aa_snapshot ADD COLUMN cost_per_task REAL;
