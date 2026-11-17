# 운영 현재값 (저장소·수집기·보존 수치)

이 문서는 자주 바뀌는 저장소·배포 상태, 수집 주기, provider 목록, 버전, 보존·한도 수치의 현재 정본이다. 절차는 `zzik-deploy`, `zzik-usage-collector` 스킬을 따른다.

## 저장소·배포 현재 상태

- 현재 운영 저장소: **D1 단독** (정본: `ADR 0.1` Access, `ADR 0.10` G1, `docs/d1-d-cutover.md`).
- G1은 PG 코드 제거이며 `DB_URL`/Neon 삭제가 아니다. `.env`/secret의 `DB_URL`과 Neon은 미사용으로 보존하고 삭제하지 않는다.
- D1 장애 대응: PG 폴백은 없다. 수집 정지 후 forward-fix 또는 R2→scratch D1 복구·id 펜스·outbox 재생으로 대응한다.
- Access 검증 대상: `qus0in` (`verify-zzik.sh qus0in`).
- Access 보호 경로: `/usage`, `/usage/*`, `/api/*` (302 → `cdn-cgi/access/login`, Worker destination 제거, Worker JWT 미들웨어가 `/api/*` 백스톱).
- 공개 경로: `/`, `/trend` (`200`, 사용량·이메일 미노출), `/pub/*` (`200` 또는 `503`, `302` 아님; `deploy-verify`/`verify-zzik.sh` 기본 검증 포함).
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

## 공개 트렌드 (#116 2~5·4a단계)

- 공개 경로: `/pub/trend`, `/pub/trend/plan-models`, `/pub/trend/new-models`, `/pub/trend/free-models`, `/pub/trend/metrics`. Access 앱에 넣지 않는다.
- 수집 cron: `7 */2 * * *` (`TREND_CRON`). 한 번에 세 출처를 조건부 GET한다: models.dev `api.json`, OpenCode Zen `/zen/v1/models`, OpenRouter `/api/v1/models`. 이어서 `plan-models` 공개 출처 OpenCode Go `/inference/go/v1/models`와 Ollama `/api/tags`를 읽는다. 출처별 실패는 격리한다(한 출처 실패가 다른 출처·섹션을 지우지 않고 해당 source만 `stale`).
- 실행 시각: UTC 짝수 시각 07분(KST 홀수 시각 07분)에 실행한다. 예를 들어 UTC 03:07이 아닌 04:07(KST 13:07)에 실행한다. 실행 로그 `trend_refresh:start`와 `trend_refresh:complete new=<written|unchanged|skipped:<이유>|error:<분류>> free=… plan=… sources=<출처:200|304|fail,…>` 한 줄로 섹션·출처 결과를 확인한다. DB 바인딩 누락은 `trend_refresh_failed:missing_db`, 처리 중 예외는 `trend_refresh_failed:unexpected:<분류>`로 남는다. 분류는 Error·TypeError·RangeError·SyntaxError·unknown만 허용하며 예외 메시지는 기록하지 않는다. `/pub/trend` 인덱스의 `checkedAt`은 `trend_source_state`의 가상 출처 `section:<id>`(섹션 평가 `written`/`unchanged` 성공 시 갱신, 폴백 없음)를 쓰며, `checkedAt` 누락·2×cron 주기 초과(`trend` 4h, `metrics` 48h)·stale 출처 시 인덱스 `status`를 `stale`로 표시한다.
- `plan-models`: 수집기(0003)가 쓰는 `trend_plan_observation`에 Worker 공개 출처(OpenCode Go `go-models`, Ollama Cloud `ollama-tags`)도 관측을 추가한다. `plan`별 첫 관측은 `baseline=1`로 저장해 첫 배포의 대량 신규를 막고, 이후 새 모델만 `first_seen_at` 최근 14일·baseline 아님 조건으로 노출한다. 그룹 정의는 `opencode-go`·`ollama-cloud`·`antigravity`·`claude-max`·`grok`·`codex`이며, **관측이 있는 그룹만** 공개 plans에 포함된다(Codex는 항상 `unavailable`). catalog이 있으면 모델 표시명·제작사·출시일을 보강하고, 매칭 실패 시 관측 표시명만 쓴다. 출처 실패 그룹은 `partial`(부분 판정)로 낮춘다. **화면에서는 제거했고 Worker 수집·`/pub/trend/plan-models` API는 유지한다.**
- `plan-models` 저장은 0003 테이블을 그대로 쓰며 새 마이그레이션이 없다. 관측 upsert는 plan별 baseline CTE 1문을 D1 batch로 실행하고, 섹션은 `trend_section`에 저장한다.
- `new-models`: 최근 7일 안에 **OpenRouter에 새로 등록된** 모델. `/api/v1/models`의 `created`를 등록 시점으로 쓰고, models.dev는 이름·제작사·가격 보강에만 쓴다. 항목에 `registeredIn:['openrouter']` 배지를 붙이고, OpenRouter 304/실패 시 이전 항목을 재사용한다. Artificial Analysis 기준·배지는 공개 재배포 불가 판정에 따라 제거했다.
- `free-models`: OpenCode Go `/inference/go/v1/models`와 Ollama Cloud `/api/tags` 목록에 포함된 모델을 `opencode-go`·`ollama-cloud` 두 그룹으로 보여 준다. 판정은 `trend_plan_observation`의 최근 7일 `last_seen_at` 목록을 쓰고, 추가 비용 없이 쓸 수 있는 모델로 표시한다. 같은 cron에서 plan 관측 갱신이 free 빌드보다 뒤에 실행되므로 목록 반영은 다음 실행(최대 2시간)까지 한 주기 늦을 수 있다.
- 구조 검증: `{}`, `{error}`, 데이터 배열/컨테이너가 없는 응답은 수집 실패로 분류해 기존 섹션 items를 보존하고 source를 `stale`로 표시한다. 구조는 정상이고 필터 결과만 0개인 경우는 정상 빈 목록으로 저장한다.
- 저장: D1 `trend_section`(섹션당 1행), `trend_source_state`(ETag·상태), `trend_plan_observation`(요금제 관측). `trend_model_seen`은 기존 데이터로 남겨 두되 new-models 판정에는 쓰지 않는다. 마이그레이션 `0002_trend.sql`·`0003`·`0004`. AA 스냅샷 테이블(`trend_aa_snapshot`)에는 매일 상위 20개 후보만 내부 저장하고 공개에는 주목 모델 문장만 내보낸다. 200 응답에 ETag가 없으면 이전 값을 재사용하지 않고 `null`을 저장한다(현재 Zen·OpenRouter는 ETag를 보내지 않는다).
- 공개 응답은 `worker/domain/trend/projection.ts`로 계약 필드만 투영한다(`extra` 등 제거). ETag는 저장 해시가 아니라 투영된 응답 본문의 SHA-256이다.
- 메모리 게이트: 본문을 스트림으로 읽어 누적 20MiB 초과 시 중단하고, 20초 타이머는 본문 읽기 완료까지 유지한다. 로컬 Node 측정(2026-11-17)은 `api.json` 6,687,479 bytes → 문자열 12.75MiB + 파싱 11.83MiB = 약 24.6MiB heap으로 128MiB 한도 안이다. workerd 통합 테스트는 작은 고정 응답으로 경로를 검증하며, 실제 6.7MiB 원문의 workerd 피크를 측정한 것은 아니다.
- 5단계 `metrics`는 일 1회 `17 0 * * *` (UTC 00:17, KST 09:17; `METRICS_CRON`)에 갱신한다. OpenRouter Data API `GET /api/v1/datasets/rankings-daily?start_date=…&end_date=…`(`Authorization: Bearer …`)와 Artificial Analysis 무료 API `/api/v2/language/models/free`를 읽는다. AA는 Internal Use로 호출해 **상위 20개 후보만** `trend_aa_snapshot`에 저장하고, 공개에는 계열별 대표를 묶어 제작사가 섞이게 고른 뒤 이름 알파벳 순으로 나열한 **"요즘 주목받는 모델로는 …이(가) 있습니다." 한 문장**만 둔다. 순위·점수·지수 이름·구조화된 모델 id는 공개하지 않는다(실제 응답의 제공 지표는 Intelligence 하나뿐). `TREND_AA_PUBLIC`은 쓰지 않는다. Data Platform Terms v1.1(2026-08-19) 기준.
  - 인증 요청은 `redirect:'manual'`로 보내고 3xx는 고정 실패로 처리한다. 다른 호스트로 키가 전달되지 않는다.
  - Worker secret는 `OR_API_KEY`와 `AA_API_KEY`를 읽는다. 키가 없으면 해당 출처만 `not_configured`로 두고 인용문을 숨긴다. 두 키 중 하나만 있어도 공개 섹션은 생성된다(AA만 있으면 인용문만). 요청은 모두 `redirect:'manual'`이고 로그에는 상태만 남긴다.
  - OpenRouter: 최근 7일 vs 직전 7일 점유율(`other` 포함 분모)과 순위를 비교한다. 토큰 절대값은 공개하지 않고 점유율·변동만 낸다. 응답은 14일 범위·날짜별 51행·중복 키·총 714행 예산을 검증하고, 위반 시 이전 스냅샷을 보존한다. `meta.version/start_date/end_date`를 보존하고 `meta.as_of`가 없으면 `asOfKind:'fetched'`로 조회 시각임을 구분한다. `CC BY 4.0` 라이선스 링크와 집계·가공 고지를 블록/UI에 포함한다.
  - OR 실패는 직전 공개 payload의 같은 블록을 `stale`로 유지한다. 로그에는 `trend_metrics:or=ok|429|unauthorized|error` 수준만 남기고 키·본문은 남기지 않는다.
  - 저장: `trend_or_ranking`(일·permaslug, 60일 보존, meta 컬럼 포함). 스냅샷 교체는 D1 `batch`로 원자화한다. `trend_aa_snapshot`은 AA 상위 20개 후보 내부 저장에 쓴다. 마이그레이션 `0004_metrics.sql`(0003은 plan-models용으로 비워 둔다).
- UI 순서는 **성능 지표 → 신규 모델 → 무료 모델 → 참고 링크**다. 성능 지표는 OpenRouter 블록과, 값이 있을 때 AA 인용 한 줄 + `Source: Artificial Analysis (artificialanalysis.ai)` 링크를 표시한다(AA 표·차트 없음). 인용은 저장 문자열을 신뢰하지 않고 검증된 이름·숫자로 만든 틀만 통과하며, 레거시 문자열도 공개 projection에서 재검사해 실패하면 제외한다. 신규 모델은 OpenRouter 등록 배지만 표시한다. 참고 링크 카드마다 해당 사이트의 지표를 한 줄로 설명하며, Artificial Analysis 링크는 `https://artificialanalysis.ai/leaderboards/models`다. 요금제 추가 섹션은 화면에서 제거했다.
- **결정 기록(2026-11-17)**: fable `/tmp/fable-terms.md` §1.5 선택지 3은 "UI 전용 하드코딩, JSON 제외"를 권고했으나, 사용자는 공개 JSON에 완성 문장 한 줄을 두는 방식을 선택했다. 구조화 필드는 없애고 문장 틀·모델명·값 검증으로 brief citation 요건을 지킨다. 이 기록은 약관 허가 판정을 대신하지 않는다.
- section/seen/source-state 갱신은 개별 D1 쓰기라 원자적이지 않다. 중간 실패 시 다음 실행에서 다시 계산한다.
- 원격 반영 순서(총괄 에이전트): `pnpm exec wrangler d1 migrations apply zzik-usage --remote` → Worker `wrangler deploy`(새 cron 포함). 원격 D1 마이그레이션은 이 작업에서 실행하지 않았다. `OR_API_KEY`와 `AA_API_KEY`는 이미 운영 secret에 등록되어 있다고 가정한다.
- **수동 채우기 (`scripts/trend-refresh-once.mjs`)**:
  - 용도: Worker cron(2시간 `7 */2 * * *`, metrics 일 1회 `17 0 * * *` = `00:17 UTC`)을 기다리지 않고 원격 D1에 트렌드 데이터를 수동으로 채울 때 사용한다.
  - 실행: `node scripts/trend-refresh-once.mjs` (기본 `dry-run`: 원격 D1 읽기 + 인메모리 SQLite 시뮬레이션, 원격 쓰기 0) → 결과 JSON 확인 후 `node scripts/trend-refresh-once.mjs --apply` (원격 D1 반영).
  - 필요 설정: `.env`에 `ZZIK_D1_ACCOUNT_ID`, `ZZIK_D1_DATABASE_ID` (선택: `OR_API_KEY`, `AA_API_KEY`), Wrangler OAuth profile `zzik-collector`.
  - 주의: D1 REST API 한도(요청당 statement 100개, SQL 100KB, params 100개, 문자열 2MB)를 검증하며 `trend_model_seen`은 100개씩 chunk flush한다. `--apply`는 운영 D1 `trend_*` 테이블에 직접 쓰므로 반드시 `dry-run`으로 `remoteWrites`/`seenWriteRequestsEstimate`/`failedRequest`를 먼저 확인한다.
  - 수동 채우기 절차: (1) 원격 D1 마이그레이션 적용 확인 → (2) `node scripts/trend-refresh-once.mjs` dry-run 확인 → (3) `node scripts/trend-refresh-once.mjs --apply` 실행 → (4) `curl -sS https://zzik.qus0in.dev/pub/trend` 200 및 섹션 상태(`ok`) 확인.
