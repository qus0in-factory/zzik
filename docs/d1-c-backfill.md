# C 백필 — G1 이후 폐기된 운영 도구

PG→D1 이관은 완료됐다. G1에서 scripts/d1-backfill.mjs, pg-backfill-source와 PG역이관·드라이버를 제거했다. 과거절차는G1이전Git이력으로확인한다. 현재checkout에서실행할수있는PG백필명령은없다.

D1복구는 기존R2 export문서형식·canonical hash·64비트문자열id·epoch ms규칙을 유지한다. worker/app/usage/restore-d1-export.ts와 D1 restore adapter로scratch D1에서 검증한다. 운영D1을덮어쓰거나Neon/DB_URL을삭제하지않는다.

이관행 해시·계획/spool·중단재개순수함수는 과거계약검증용으로 남아있어도PG연결을만들지않는다. 새복구도구는dry-run기본·명시확인·개수/해시/id고수위펜스를갖춰야한다. 디스크여유와 자기spool잔여물을확인하고와일드카드삭제/상태디렉터리삭제는하지않는다.
