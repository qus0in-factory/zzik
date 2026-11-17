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

## 공개 트렌드 (#116 2~5·4a단계)

- 공개 경로: `/pub/trend`, `/pub/trend/plan-models`, `/pub/trend/new-models`, `/pub/trend/free-models`, `/pub/trend/metrics`. Access 앱에 넣지 않는다.
- 수집 cron: `7 */2 * * *` (`TREND_CRON`). UTC 짝수 시각 07분(KST 홀수 시각 07분)에 실행한다. 예를 들어 UTC 03:07이 아닌 04:07(KST 13:07)에 실행한다. 실행 로그 `trend_refresh:start`와 `trend_refresh:complete`로 시작·완료를 확인한다. DB 바인딩 누락은 `trend_refresh_failed:missing_db`, 처리 중 예외는 `trend_refresh_failed:unexpected:<분류>`로 남는다. 분류는 Error·TypeError·RangeError·SyntaxError·unknown만 허용하며 예외 메시지는 기록하지 않는다. 한 번에 세 출처를 조건부 GET한다: models.dev `api.json`, OpenCode Zen `/zen/v1/models`, OpenRouter `/api/v1/models`. 이어서 `plan-models` 공개 출처 OpenCode Go `/inference/go/v1/models`와 Ollama `/api/tags`를 읽는다. 출처별 실패는 격리한다(한 출처 실패가 다른 출처·섹션을 지우지 않고 해당 source만 `stale`).
- `plan-models`: 수집기(0003)가 쓰는 `trend_plan_observation`에 Worker 공개 출처도 관측을 추가한다. `plan`별 첫 관측은 `baseline=1`로 저장해 첫 배포의 대량 신규를 막고, 이후 새 모델만 `first_seen_at` 최근 14일·baseline 아님 조건으로 노출한다. `opencode-go`·`ollama-cloud`는 catalog, Antigravity/Claude/Grok은 수집기의 account/partial 관측을 쓴다. `claude-display:<정규화 표시명>` 키는 models.dev 이름 매칭으로 표시명·제작사·출시일을 보강하고, 매칭 실패 시 표시명만 보여 준다. partial 항목 또는 출처 실패 그룹은 `partial`(부분 판정), Codex(4c 미구현)·Grok 미관측은 `unavailable`(판정 불가)로 표시한다.
- `plan-models` 저장은 0003 테이블을 그대로 쓰며 새 마이그레이션이 없다. 관측 upsert는 plan별 baseline CTE 1문을 D1 batch로 실행하고, 섹션은 `trend_section`에 저장한다.
- `new-models`: models.dev 304면 저장된 `firstSeenAt`·`releaseMs`로 7일 창을 재평가하고 출처 상태를 `ok`로 회복한다.
- `free-models`: 호스팅 무료(Zen `price 0` ∪ OpenRouter `:free`/가격 0)와 로컬 실행 가능(models.dev `ollama-cloud` + `open_weights`)을 최근 30일 창으로 고른다. deprecated·`expiration_date` 만료는 제외하고 canonical id로 중복 제거한다. 출처별 마지막 items를 저장 payload의 `sourceItems`에 보관해 실패/304 시 재사용하며, 공개 응답에서는 projection이 제거한다. 로컬 섹션은 호스팅 무료와 겹치는 모델을 호스팅 쪽 provider로 합친다.
- 구조 검증: `{}`, `{error}`, 데이터 배열/컨테이너가 없는 응답은 수집 실패로 분류해 기존 섹션 items를 보존하고 source를 `stale`로 표시한다. 구조는 정상이고 필터 결과만 0개인 경우는 정상 빈 목록으로 저장한다.
- 저장: D1 `trend_section`(섹션당 1행), `trend_source_state`(ETag·상태), `trend_model_seen`(canonical id·first_seen). 마이그레이션 `0002_trend.sql`. 200 응답에 ETag가 없으면 이전 값을 재사용하지 않고 `null`을 저장한다(현재 Zen·OpenRouter는 ETag를 보내지 않는다).
- 공개 응답은 `worker/domain/trend/projection.ts`로 계약 필드만 투영한다(`extra` 등 제거). ETag는 저장 해시가 아니라 투영된 응답 본문의 SHA-256이다.
- 메모리 게이트: 본문을 스트림으로 읽어 누적 20MiB 초과 시 중단하고, 20초 타이머는 본문 읽기 완료까지 유지한다. 로컬 Node 측정(2026-11-17)은 `api.json` 6,687,479 bytes → 문자열 12.75MiB + 파싱 11.83MiB = 약 24.6MiB heap으로 128MiB 한도 안이다. workerd 통합 테스트는 작은 고정 응답으로 경로를 검증하며, 실제 6.7MiB 원문의 workerd 피크를 측정한 것은 아니다.
- 5단계 `metrics`는 일 1회 `17 0 * * *` (UTC 00:17, KST 09:17; `METRICS_CRON`)에 갱신한다. Artificial Analysis `GET /api/v2/language/models/free?page=N`(헤더 `x-api-key`)와 OpenRouter Data API `GET /api/v1/datasets/rankings-daily?start_date=…&end_date=…`(`Authorization: Bearer …`)를 읽는다.
  - 인증 요청은 `redirect:'manual'`로 보내고 3xx는 고정 실패로 처리한다. 다른 호스트로 키가 전달되지 않는다.
  - Worker secret `AA_API_KEY`·`OR_API_KEY`는 `env`에서만 읽는다. 둘 다 없어도 기존 metrics payload가 있으면 외부 요청 없이 두 블록을 `not_configured`로 갱신한다. 한쪽만 없으면 해당 블록만 `not_configured`이고 다른 블록은 갱신된다.
  - AA: `intelligence_index_version`이 같을 때만 7일 전 스냅샷과 순위를 비교한다(상위 15 + 16~30위 ±3위 변동). 버전이 바뀌면 변동을 리셋하고 `version_changed`를 표시한다. 7일 스냅샷이 없으면 `baseline`으로 현재 순위만 보여 준다.
  - OpenRouter: 최근 7일 vs 직전 7일 점유율(`other` 포함 분모)과 순위를 비교한다. 토큰 절대값은 공개하지 않고 점유율·변동만 낸다. 응답은 14일 범위·날짜별 51행·중복 키·총 714행 예산을 검증하고, 위반 시 이전 스냅샷을 보존한다. `meta.version/start_date/end_date`를 보존하고 `meta.as_of`가 없으면 `asOfKind:'fetched'`로 조회 시각임을 구분한다. `CC BY 4.0` 라이선스 링크와 집계·가공 고지를 블록/UI에 포함한다.
  - 실패 블록은 직전 공개 payload의 같은 블록을 `stale`로 유지한다. AA는 429/401을 구분해 로그에 `aa=429|unauthorized` 수준만 남기고 키·본문은 남기지 않는다.
  - 저장: `trend_aa_snapshot`(일·slug, 90일 보존), `trend_or_ranking`(일·permaslug, 60일 보존, meta 컬럼 포함). 스냅샷 교체는 D1 `batch`로 원자화하고, 저장소 예외는 해당 출처만 stale로 낮춰 다른 출처 갱신을 막지 않는다. 마이그레이션 `0004_metrics.sql`(0003은 plan-models용으로 비워 둔다).
  - AA 공개는 기본 비활성이다. `TREND_AA_PUBLIC='0'`(기본)이면 AA 수집·스냅샷 저장은 계속하되 공개 projection/UI에서 AA 블록을 `under_review`('출처 약관 확인 중')로 숨긴다. `='1'`일 때만 Intelligence Index 점수를 공개한다.
  - AA 약관상 재배포 조건(Terms PDF) 확인 전에는 `TREND_AA_PUBLIC`을 켜지 않는다.
- UI는 `요금제 추가`(준비 중) → 최신 → free → 성능 지표 → 참고 링크 순서다. `frontier`는 아직 준비 중이다.
- section/seen/source-state 갱신은 개별 D1 쓰기라 원자적이지 않다. 중간 실패 시 다음 실행에서 다시 계산한다.
- 원격 반영 순서(opus): `pnpm exec wrangler d1 migrations apply zzik-usage --remote` → Worker `wrangler deploy`(새 cron 포함). 원격 D1 마이그레이션은 이 작업에서 실행하지 않았다. `AA_API_KEY`·`OR_API_KEY`는 이미 운영 secret에 등록되어 있다고 가정한다.
