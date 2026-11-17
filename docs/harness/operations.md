# 운영 현재값 (저장소·수집기·보존 수치)

이 문서는 자주 바뀌는 저장소·배포 상태, 수집 주기, provider 목록, 버전, 보존·한도 수치의 현재 정본이다. 절차는 `zzik-deploy`, `zzik-usage-collector` 스킬을 따른다.

## 저장소·배포 현재 상태

- 현재 운영 저장소: **D1 단독** (정본: `ADR 0.1` Access, `ADR 0.10` G1, `docs/d1-d-cutover.md`).
- G1은 PG 코드 제거이며 `DB_URL`/Neon 삭제가 아니다. `.env`/secret의 `DB_URL`과 Neon은 미사용으로 보존하고 삭제하지 않는다.
- D1 장애 대응: PG 폴백은 없다. 수집 정지 후 forward-fix 또는 R2→scratch D1 복구·id 펜스·outbox 재생으로 대응한다.
- Access 검증 대상: `qus0in` (`verify-zzik.sh qus0in`).
- 공개 API 경로: `/pub/*` (인증 미적용; Access 변경 전까지는 Worker destination으로 302 반환, 변경 후 `--check-public`으로 확인).
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
| `claude` | `300초` | provider 429 시 자동 `900초` 강등, 24시간부터 최대 7일 |

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

## 공개 트렌드 (#116 2~3단계)

- 공개 경로: `/pub/trend`, `/pub/trend/new-models`, `/pub/trend/free-models`. Access 앱에 넣지 않는다.
- 수집 cron: `7 */2 * * *` (`TREND_CRON`). 한 번에 세 출처를 조건부 GET한다: models.dev `api.json`, OpenCode Zen `/zen/v1/models`, OpenRouter `/api/v1/models`. 출처별 실패는 격리한다(한 출처 실패가 다른 출처·섹션을 지우지 않고 해당 source만 `stale`).
- `new-models`: models.dev 304면 저장된 `firstSeenAt`·`releaseMs`로 7일 창을 재평가하고 출처 상태를 `ok`로 회복한다.
- `free-models`: 호스팅 무료(Zen `price 0` ∪ OpenRouter `:free`/가격 0)와 로컬 실행 가능(models.dev `ollama-cloud` + `open_weights`)을 최근 30일 창으로 고른다. deprecated·`expiration_date` 만료는 제외하고 canonical id로 중복 제거한다. 출처별 마지막 items를 저장 payload의 `sourceItems`에 보관해 실패/304 시 재사용하며, 공개 응답에서는 projection이 제거한다. 로컬 섹션은 호스팅 무료와 겹치는 모델을 호스팅 쪽 provider로 합친다.
- 구조 검증: `{}`, `{error}`, 데이터 배열/컨테이너가 없는 응답은 수집 실패로 분류해 기존 섹션 items를 보존하고 source를 `stale`로 표시한다. 구조는 정상이고 필터 결과만 0개인 경우는 정상 빈 목록으로 저장한다.
- 저장: D1 `trend_section`(섹션당 1행), `trend_source_state`(ETag·상태), `trend_model_seen`(canonical id·first_seen). 마이그레이션 `0002_trend.sql`. 200 응답에 ETag가 없으면 이전 값을 재사용하지 않고 `null`을 저장한다(현재 Zen·OpenRouter는 ETag를 보내지 않는다).
- 공개 응답은 `worker/domain/trend/projection.ts`로 계약 필드만 투영한다(`extra` 등 제거). ETag는 저장 해시가 아니라 투영된 응답 본문의 SHA-256이다.
- 메모리 게이트: 본문을 스트림으로 읽어 누적 20MiB 초과 시 중단하고, 20초 타이머는 본문 읽기 완료까지 유지한다. 로컬 Node 측정(2026-11-17)은 `api.json` 6,687,479 bytes → 문자열 12.75MiB + 파싱 11.83MiB = 약 24.6MiB heap으로 128MiB 한도 안이다. workerd 통합 테스트는 작은 고정 응답으로 경로를 검증하며, 실제 6.7MiB 원문의 workerd 피크를 측정한 것은 아니다.
- 3단계에서 `new-models`·`free-models`가 실데이터다. `frontier`와 UI의 `요금제 추가`·`성능 지표`는 아직 준비 중 자리만 둔다.
- section/seen/source-state 갱신은 개별 D1 쓰기라 원자적이지 않다. 중간 실패 시 다음 실행에서 다시 계산한다.
- 원격 반영 순서(opus): `pnpm exec wrangler d1 migrations apply zzik-usage --remote` → Worker `wrangler deploy`(새 cron 포함). 원격 D1 마이그레이션은 이 작업에서 실행하지 않았다.
