---
name: zzik-deploy
description: zzik 배포·배포 후 검증·수집기 재시작 시 사용. P3 KV 제거 완료·Postgres 단독 저장소, 6개 제공자·900초 주기, release 운영 반영·롤백, 미인증 302·workers.dev 404 검증 절차.
---

# zzik 배포 · 검증

Access는 ADR 0.1, 사용량 계약은 ADR 0.2/0.3/0.4/0.6, 저장소 전환은 docs/adr/0.5-postgres-storage.md를 따른다. 최신 설정값은 ADR/코드가 정본이다.

## 1. 저장소 상태 (ADR 0.5 P3)

- P3 구현 완료: 수집기 KV writer/fanout, Worker KV reader, USAGE_KV_KEYS, wrangler kv_namespaces를 제거했다. Worker와 수집기 모두 Postgres 단독이며 ecosystem은 ZZIK_STORE=postgres다. kv/both는 종료 78이다. 코드 완료와 운영 반영은 구분하며 release 반영·재시작·배포 검증 전에는 운영 P3 완료로 기록하지 않는다.
- 제공자는 claude,codex,antigravity,opencode,grok,ollama 6개다. ZZIK_AGY_CLI_PATH는 실행 가능한 agy 절대경로를 유지한다. 수집·UI 자동 조회 모두 900초이며 30일 이력을 보존한다.
- Worker는 postgres.js 직접 TCP, drizzle, nodejs_compat를 사용한다. 풀러 연결 문자열 권장, prepare:false. DB_URL 누락 시 인증 후 503 storage_unavailable이다(Access 설정 실패 500과 구분). schema 변경은 별도 승인 후 마이그레이션하며 운영 프로세스가 자동 migrate하지 않는다.
- Neon Free 기준은 100 CU-h/월, 최소 0.25 CU, 5분 suspend, 보수적인 0.5GB·30일 보존(공식 저장 한도 1GB)이다. 오토스케일 상한 2 CU 추정이므로 월 CU-h를 관측한다. 900초의 약 61 CU-h 산식은 각성 중 0.25 CU 유지 전제다.
- P2 대조·배포 검증 후 사용자 승인으로 P3의 24시간 관측 대기는 생략했다. 실제 인증 Cloudflare DB 요청·브라우저 화면 검증의 미완료 여부는 운영 보고에 별도 기록한다.
- **롤백**: KV 네임스페이스 삭제 전까지만 가능하다. 먼저 P2 코드와 ZZIK_STORE=both 설정의 수집기를 복구하고 --update-env·save → 첫 주기 양 저장소 성공 및 KV 최신성 확인 → 이전 KV 읽기 Worker로 되돌린다. P3 수집기가 운영 중이면 KV는 갱신되지 않으므로 Worker만 단독으로 되돌리지 않는다. 네임스페이스 자체 삭제는 코드 배포·검증 후 별도 사용자 지시가 있을 때만 수행한다.

## 2. release 배포

- dev→main PR 병합 뒤에만 .worktree/release(main)에서 git pull → pnpm install --frozen-lockfile.
- P3 수집기 반영: pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env → pm2 save. runtime/saved의 ZZIK_STORE=postgres, 제공자 6개·900초·agy 경로·release cwd/env-file 일치를 값 노출 없이 확인한다. 게이트/상태는 삭제하지 않는다.
- 첫 주기 Postgres 저장 성공·usage_snapshot 6행/JSONB object 및 실제 코드 기능 대조를 확인한 뒤 pnpm run deploy. 실패하면 중단·보고한다. 자세한 재시작 절차는 zzik-usage-collector 스킬 참조.
- 전제: wrangler whoami 계정이 ADR 0.1 기대 계정과 일치. DB_URL secret 존재와 승인된 저장소 검증 완료를 별도로 확인. 연결 문자열은 출력하지 않는다.
- workers_dev:false, preview_urls:false 유지. preview 업로드/alias 사용 금지. Access 앱/정책은 ADR 0.1 그대로, Bypass/Service Auth 추가 없음.
- DB_URL, 이메일 바인딩, Access Location 전문, 원문 응답이 도구 stdout에 나오지 않도록 출력은 승인된 필드로 제한한다.
- **설정 파일(wrangler.jsonc 등) 출력 시 ALLOWED_EMAIL·DB_URL 등 민감 값은 grep -v/jq로 가리고 전문 출력은 금지한다.** 가능한 경우 허용 필드만 선택한다. .env는 존재 여부만 boolean으로 확인하며 cat하지 않는다. Wrangler 배포·whoami·verify 출력도 캡처 후 안전한 상태/버전/PASS 필드만 출력한다.

## 3. 배포 후 검증

- 쿠키 없는 요청 /, /api/usage, /api/usage/claude, /api/usage/codex, /api/usage/antigravity, /api/usage/opencode, /api/usage/grok, /api/usage/ollama 모두 302, Location에 cdn-cgi/access/login 포함, 본문 앱 데이터 없음 확인. 헤더·본문 전문은 출력하지 않는다.
- scripts/verify-zzik.sh qus0in으로 workers.dev 404(또는 DNS 미해석·Access 302) 확인. 기본 스크립트 stdout에 Location 전문이 있으므로 안전한 PASS/FAIL/status만 추려 출력한다.
- 스크립트는 /만 검사한다. API는 위 7개 경로도 각각 확인한다.
- DNS 캐시 문제는 새 엣지 IP와 curl --resolve로 대조한다.
- 배포 출력이 승인된 custom domain 외 경로를 공개하거나 검증이 실패하면 설정 확인 후 중단한다.

## 4. 기능 대조·수집기

- scripts/usage-live-shape.sh provider는 이제 Postgres의 envelope를 읽는다. .env를 가진 체크아웃에서만 실행하며 원문 파이프를 중간 파일로 저장하지 않는다. 원문 fetch 도우미를 직접 실행해 출력하지 않는다.
- 배포본의 실제 load/visible 경로로 DB 봉투를 변환해 제공자별 카드 라벨/사용률/리셋을 비교한다. rawRedacted를 포함해 검증한다. 단순 302 성공만으로 완료 처리하지 않는다.
- PM2 운영 수집기 cwd는 .worktree/release. 로그 kvOk/kvReason·kv= 이름은 Postgres 저장 결과를 나타내는 호환 명칭이다. 실패 시 DB_URL/Neon 연결·한도·마이그레이션을 점검한다.
- 계약·저장소 변경 배포 후 재시작 여부는 승인된 단계에 따른다. 무조건 재시작하지 않는다.
- 배포·운영 명령은 워커 에이전트가 실행하고 설계·검수 에이전트는 결과를 확인한다.
