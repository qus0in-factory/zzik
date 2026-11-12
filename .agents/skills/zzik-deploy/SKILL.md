---
name: zzik-deploy
description: zzik 배포·배포 후 검증·수집기 재시작 시 사용. Postgres(Neon) 단독 저장소(P3 KV 제거 완료), 6개 제공자(claude/codex/antigravity/opencode/grok/ollama), 900초 주기, ZZIK_AGY_CLI_PATH, release 배포, 미인증 302·workers.dev 404 검증 절차.
---

# zzik 배포 · 검증

Access는 ADR 0.1, 사용량 계약은 ADR 0.2/0.3/0.4/0.6, 저장소 구조는 docs/adr/0.5-postgres-storage.md를 따른다. 최신 설정값은 ADR/코드가 정본이다.

## 1. 저장소 구조 및 운영 기준 (Postgres / Neon)

- **저장소 상태**: P3(KV 제거) 완료에 따라 Neon Postgres 단독 저장소 체계다. Worker의 KV 바인딩 및 수집기의 KV 쓰기는 완전히 제거되었으며, 모든 읽기/쓰기는 Postgres(`usage_snapshot`, `usage_event`)로 일원화된다.
- **제공자 (6개)**: `claude`, `codex`, `antigravity`, `opencode`, `grok`, `ollama`. 매 주기 6개 행이 갱신된다.
- **주기 및 예산**: 수집 주기와 UI 자동 조회 주기 모두 900초(15분)를 유지한다. Neon Free 한도(100 CU-h/월, 최소 0.25 CU, 5분 suspend, 1GB 저장소)를 초과하지 않도록 300초로 임의 축소하지 않는다.
- **Antigravity CLI**: Antigravity의 Argon 주간 한도는 CLI(`agy -p /quota`)로 수집하므로, 배포 및 수집기 실행 환경에 `ZZIK_AGY_CLI_PATH`(기본값 `agy`)가 올바르게 설정되어야 한다(`ZZIK_AGY_CLI_ENABLED=0`이면 생략).
- **Worker 연결**: Cloudflare Worker는 `postgres.js` 직접 TCP 연결, Drizzle ORM, `nodejs_compat` 플래그를 사용한다. Neon 연결 풀러 엔드포인트를 사용하며 `prepare:false` 설정 필수. DB_URL 누락 시 503 `storage_unavailable`을 반환한다(Access 실패 500과 구분).

## 2. release 배포

- `dev → main` PR 병합 뒤에만 `.worktree/release`(main)에서 `git pull` → `pnpm install --frozen-lockfile` → `pnpm run deploy` 순서로 진행.
- 전제: `wrangler whoami` 계정이 ADR 0.1 기대 계정과 일치. Worker `DB_URL` secret 주입 여부 확인.
- `workers_dev: false`, `preview_urls: false` 유지. preview 업로드/alias 사용 금지. Access 앱/정책은 ADR 0.1 유지, Bypass/Service Auth 임의 추가 금지.
- DB_URL, 이메일 바인딩, Access Location 전문, 원문 응답이 도구 stdout에 노출되지 않도록 출력은 승인된 필드로 엄격히 제한한다.

## 3. 배포 후 검증

- **비인증 302 검증**: 쿠키 없는 요청으로 다음 경로를 각각 확인:
  - `/`
  - `/api/usage`
  - `/api/usage/claude`
  - `/api/usage/codex`
  - `/api/usage/antigravity`
  - `/api/usage/opencode`
  - `/api/usage/grok`
  - `/api/usage/ollama`
  모두 HTTP 302, Location 헤더에 `cdn-cgi/access/login` 포함, 본문 응답 데이터 없음을 확인. 헤더·본문 전문은 출력하지 않는다.
- **workers.dev 차단 검증**: `scripts/verify-zzik.sh qus0in`으로 workers.dev 404(또는 DNS 미해석·Access 302) 확인. 안전한 PASS/FAIL/status 요약만 출력.
- 배포 출력이 승인된 custom domain 외 경로를 노출하거나 검증이 실패하면 즉시 설정을 확인하고 중단한다.

## 4. 기능 대조 · 수집기 운영

- **실데이터 형상 대조**: `scripts/usage-live-shape.sh [provider]` (claude, codex, antigravity, opencode, grok, ollama 지원)로 Postgres에 저장된 envelope를 읽어 화면/픽스처 기대치와 대조. `.env`가 있는 체크아웃에서만 실행하며 원문 파이프를 중간 파일로 남기지 않는다.
- **카드 및 지표 대조**: 배포본의 실제 load/visible 변환 로직으로 DB 봉투를 변환해 제공자별 카드 라벨/사용률/리셋 시각을 대조한다 (`rawRedacted` 및 Argon 카드 포함 여부 확인).
- **PM2 운영 수집기**: cwd는 `.worktree/release`. 900초 주기, 6개 제공자 정상 수집(`usage_snapshot` 6개 행 run_at 전진), Postgres 저장 성공 확인.
- 배포·운영 명령은 워커 에이전트가 실행하고 설계·검수 에이전트는 결과를 확인한다.
