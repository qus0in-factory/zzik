# 운영 현재값 (저장소·수집기·보존 수치)

이 문서는 자주 바뀌는 저장소·배포 상태, 수집 주기, provider 목록, 버전, 보존·한도 수치의 현재 정본이다. 절차는 `zzik-deploy`, `zzik-usage-collector` 스킬을 따른다.

## 저장소·배포 현재 상태

- 현재 운영 저장소: **D1 단독** (정본: `ADR 0.1` Access, `ADR 0.10` G1, `docs/d1-d-cutover.md`).
- G1은 PG 코드 제거이며 `DB_URL`/Neon 삭제가 아니다. `.env`/secret의 `DB_URL`과 Neon은 미사용으로 보존하고 삭제하지 않는다.
- D1 장애 대응: PG 폴백은 없다. 수집 정지 후 forward-fix 또는 R2→scratch D1 복구·id 펜스·outbox 재생으로 대응한다.
- Access 검증 대상: `qus0in` (`verify-zzik.sh qus0in`).
- 로컬 통합 검증: `deploy-verify`의 D1 workerd.

## 수집기 현재 설정

- 운영 인스턴스: `release`의 `zzik-usage-collector` 하나.
- 런타임 버전: `Node 24.22+`.
- 기본 env: D1/OAuth 전용 `zzik-collector` profile.
- state-dir capability: `{ "v":1,"readStore":"d1","bucketRoute":true }`.
- 명시 `postgres` 종료 코드: `78` (PG writer/백필 없음).
- PM2 종료·대기 설정: `kill_timeout 35000`, `30초` quiesce.

## provider 목록 및 수집 주기

현재 provider는 6개이며 기본 수집 주기는 다음과 같다.

| provider | 기본 주기 | 비고 |
|---|---|---|
| `codex` | `180초` | 429/gate 시 `900` override |
| `antigravity` | `180초` | 429/gate 시 `900` override |
| `opencode` | `180초` | 429/gate 시 `900` override |
| `grok` | `180초` | 429/gate 시 `900` override |
| `ollama` | `180초` | 429/gate 시 `900` override |
| `claude` | `900초` | 상한·복귀 주기 `900초` |

## 보존·경보 수치

- D1 이력·bucket 확인 범위: `30일` bucket.
- export 경보 임계: `36시간`.
- R2 백업 보존: `30일` 이상.
- 이벤트 정리: `30일`, receipt 정리: `35일`.

## 배포·알림 통합 (`scripts/ship.mjs`)

- 실행 단계 (기본 dry-run, `--apply`만 실행):
  1. `release_prep`: `node scripts/release-prep.mjs --apply`
  2. `pr_merge`: `gh pr merge --merge`
  3. `release_sync`: `.worktree/release`에서 `git pull --ff-only` → `pnpm install --frozen-lockfile` → clean 확인
  4. `scope`: 직전 `main`과 비교해 변경 범위 판정
  5. `deploy_worker`: 대상 변경 시 `node scripts/deploy-verify.mjs --deploy`
  6. `apply_collector`: 대상 변경 시 `node scripts/collector-apply.mjs --apply`
  7. `verify_request`: `verify-request.mjs` 형식으로 확인/완료 본문 생성 (`--kind verify|done`, `--summary`, `--check`, `--issues`)
  8. `notify_discord`: `scripts/notify-discord.sh` 전송 (실패 시 `--notify-failure`가 있으면 실패 알림 전송)

| 변경 경로 | Worker 배포 (`deploy-verify`) | 수집기 반영 (`collector-apply`) | 기본 `--kind` |
|---|---|---|---|
| `src/` | 실행 | — | `verify` (화면 확인 요청) |
| `worker/`, `wrangler.jsonc` | 실행 | — | `done` |
| `collector/` | — | 실행 | `done` |
| `shared/` | 실행 | 실행 | `done` (`src/` 동반 시 `verify`) |
| 그 외 (`docs/` 등) | 생략 | 생략 | `done` |
