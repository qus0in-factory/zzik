-- #116 AA 속도·응답 시간 원시 필드 저장(내부 /api/trend/aa 전용).
ALTER TABLE trend_aa_snapshot ADD COLUMN output_tokens_per_second REAL;
ALTER TABLE trend_aa_snapshot ADD COLUMN time_to_first_token_seconds REAL;
