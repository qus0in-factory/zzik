# C 백필 — G1 이후 폐기된 운영 도구

PG→D1 이관은 완료됐다. G1에서 scripts/d1-backfill.mjs, pg-backfill-source와 PG 역이관·드라이버를 제거했다. 과거 절차는 G1 이전 Git 이력으로 확인한다. 현재 checkout에서 실행할 수 있는 PG 백필 명령은 없다.

D1 복구는 기존 R2 export 문서 형식·canonical hash·64비트 문자열 id·epoch ms 규칙을 유지한다. worker/app/usage/restore-d1-export.ts와 D1 restore adapter로 scratch D1에서 검증한다. 운영 D1을 덮어쓰거나 Neon/DB_URL을 삭제하지 않는다.

이관 행 해시·계획/spool·중단 재개 순수 함수는 과거 계약 검증용으로 남아 있어도 PG 연결을 만들지 않는다. 새 복구 도구는 dry-run 기본·명시 확인·개수/해시/id 고수위 펜스를 갖춰야 한다. 디스크 여유와 자기 spool 잔여물을 확인하고 와일드카드 삭제/상태 디렉터리 삭제는 하지 않는다.
