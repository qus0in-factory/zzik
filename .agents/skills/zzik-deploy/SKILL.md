---
name: zzik-deploy
description: zzik 배포·배포 후 검증·수집기 재시작 시 사용. ADR 0.5 P1 Postgres/KV 이중 쓰기·P2 Worker TCP 읽기·G0/G1/G2 게이트, release 배포, 미인증 302·workers.dev 404 검증 절차.
---

# zzik 배포 · 검증

Access는 ADR 0.1, 사용량 계약은 ADR 0.2/0.3/0.4, 저장소 전환은 docs/adr/0.5-postgres-storage.md를 따른다. 최신 설정값은 ADR/코드가 정본이다.

## 1. 저장소 전환 단계 (ADR 0.5)

- P0: drizzle 마이그레이션을 생성·커밋한 뒤 승인된 Mac에서 pnpm db:migrate. .env의 DB_URL을 사용하며 값/접속 오류 원문을 출력하지 않는다. 운영 Worker/수집기가 자동 migrate하지 않는다.
- G0: 공식 문서/DB 대조는 ADR 0.5 기록 참조. 설계 기준은 100 CU-h/월, 최소 0.25 CU, 5분 suspend, 보수적인 0.5GB·30일 보존(현재 공식 한도 1GB). 풀러 사용·오토스케일 상한 2 CU 추정이므로 월 CU-h 관측이 필요하며 61 CU-h 산식은 각성 중 0.25 CU 유지 전제다. 수집·UI 자동 조회 모두 900초를 유지한다.
- P1: 별도 승인 후 release 수집기를 ZZIK_STORE=both, ZZIK_INTERVAL_SEC=900으로 재시작한다. DB와 KV에 같은 봉투를 쓴다. Worker는 이 단계 동안 기존 KV 읽기 배포본을 유지한다.
- P1 검증: 1시간 동안 저장 성공률, usage_snapshot 3행의 run_at이 15분 주기로 전진하는지, Neon 각성 그래프를 확인한다. 재시작은 zzik-usage-collector 스킬 참조.
- P2: P1 검증 뒤 사용자가 Worker DB_URL secret을 주입하고 Postgres 읽기 Worker를 배포한다. Worker는 postgres.js 직접 TCP, drizzle, nodejs_compat를 사용한다. 풀러 연결 문자열 권장, prepare:false. DB_URL 누락 시 인증 후 503 storage_unavailable이 정상이다(Access 설정 실패 500과 구분).
- G2: 실제 DB 행과 인증 API의 snapshot.fetchedAt 일치, 3개 섹션 정상, 24시간 관측 후 P3 승인 요청.
- P3(KV 어댑터/바인딩 제거)는 이번 구현 범위 밖. 네임스페이스 삭제는 별도 승인.
- 롤백: P2 장애는 이전 KV 읽기 Worker 재배포. P1 both 쓰기를 유지하므로 KV가 최신이다. P1 장애는 이전 수집기 코드/설정으로 복귀.

## 2. release 배포

- dev→main PR 병합 뒤에만 .worktree/release(main)에서 git pull → pnpm install --frozen-lockfile → pnpm run deploy 순서.
- 전제: wrangler whoami 계정이 ADR 0.1 기대 계정과 일치. P2에서는 DB_URL secret 주입과 P1 검증 완료를 별도로 확인.
- workers_dev:false, preview_urls:false 유지. preview 업로드/alias 사용 금지. Access 앱/정책은 ADR 0.1 그대로, Bypass/Service Auth 추가 없음.
- DB_URL, 이메일 바인딩, Access Location 전문, 원문 응답이 도구 stdout에 나오지 않도록 출력은 승인된 필드로 제한한다.

## 3. 배포 후 검증

- 쿠키 없는 요청 /, /api/usage, /api/usage/claude, /api/usage/codex, /api/usage/antigravity 모두 302, Location에 cdn-cgi/access/login 포함, 본문 앱 데이터 없음 확인. 헤더·본문 전문은 출력하지 않는다.
- scripts/verify-zzik.sh qus0in으로 workers.dev 404(또는 DNS 미해석·Access 302) 확인. 기본 스크립트 stdout에 Location 전문이 있으므로 안전한 PASS/FAIL/status만 추려 출력한다.
- 스크립트는 /만 검사한다. API는 위 4개 경로도 각각 확인한다.
- DNS 캐시 문제는 새 엣지 IP와 curl --resolve로 대조한다.
- 배포 출력이 승인된 custom domain 외 경로를 공개하거나 검증이 실패하면 설정 확인 후 중단한다.

## 4. 기능 대조·수집기

- scripts/usage-live-shape.sh provider는 이제 Postgres의 envelope를 읽는다. .env를 가진 체크아웃에서만 실행하며 원문 파이프를 중간 파일로 저장하지 않는다. P1에서 Worker는 KV일 수 있으므로 DB·KV 상태를 혼동하지 않는다.
- 배포본의 실제 load/visible 경로로 DB 봉투를 변환해 제공자별 카드 라벨/사용률/리셋을 비교한다. rawRedacted를 포함해 검증한다. 단순 302 성공만으로 완료 처리하지 않는다.
- PM2 운영 수집기 cwd는 .worktree/release. 로그 kvOk/kvReason 이름은 P1/P2에서도 양 저장소 결과를 나타내는 호환 명칭으로 유지한다.
- 계약·저장소 변경 배포 후 재시작 여부는 승인된 단계에 따른다. 무조건 재시작하지 않는다.
- 배포·운영 명령은 워커 에이전트가 실행하고 설계·검수 에이전트는 결과를 확인한다.
