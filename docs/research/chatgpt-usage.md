# 이슈 #13 — ChatGPT(Codex 구독) 사용량 수집 조사

조사일: 2026-11-11. 저장소·인증 파일은 읽기만 했고, 이 보고서만 /tmp에 작성했다. /tmp/biseo는 이미 존재하여 클론하지 않았다. 실제 인증값을 사용한 HTTP 조회, 로그인, refresh, PM2 등록, KV 쓰기는 실행하지 않았다. 아래 raw 예시는 테스트에서 재구성한 합성 데이터이며 실제 계정 응답이 아니다.

## 결론

SSH/PM2에서 **기존 파일 인증으로 조회하는 것은 가능**하다. 다만 auth.json을 읽기만 하는 별도 수집기는 토큰을 갱신하지 않는다. Codex가 장기간 실행되지 않는 상황까지 무인 운영하려면 갱신 소유자를 정해야 한다. GUI Keychain 승인을 전제로 삼지 않는 파일 저장 방식이 맞다. 초기 로그인·인증 취소 이후 재로그인까지 완전히 사람 없이 보장할 수는 없다.

가장 작은 확장은 biseo처럼 WHAM HTTP를 호출하는 Codex 제공자다. 더 유지보수하기 좋은 후보는 공식 Codex app-server의 `account/rateLimits/read`다. 후자는 인증 갱신을 Codex에 맡길 수 있지만 별도 프로세스/JSON-RPC 연결이 필요하다. 두 방식 모두 실제 설치 버전과 이 계정에서의 동작 검증은 아직 하지 않았다.

## 1. biseo 구현 근거

경로는 모두 `/tmp/biseo/` 기준이다.

| 항목 | 확인한 동작 | 파일:줄 |
|---|---|---|
| 엔드포인트 | 기본 `https://chatgpt.com/backend-api/wham/usage`, `BISEO_CODEX_USAGE_URL`로 교체 가능 | src/domain/usage-endpoints-base.ts:4 |
| 인증 파일 | `BISEO_CODEX_AUTH_PATH` 또는 `homedir()/.codex/auth.json` | src/infra/credential-paths.ts:3 |
| 인증 필드 | `tokens.access_token`을 매 조회 때 파일에서 읽음 | src/infra/codex-wham-fetch.ts:10–12 |
| 요청 | fetch 기본 GET, `Authorization: Bearer <access token>` | src/infra/codex-wham-fetch.ts:13–15 |
| 추가 헤더 | 이 구현에는 ChatGPT-Account-Id, OpenAI-Beta, 쿠키 설정이 없음. 이것이 모든 계정에서 불필요하다는 뜻은 아님 | 같은 파일:13–16 |
| 타임아웃 | 기본 5,000ms, `BISEO_USAGE_TIMEOUT_MS` | src/domain/usage-endpoints-timeout.ts:2 |
| 401/403 | `unknownUsage('codex', 'auth_required')` | src/infra/codex-wham-fetch.ts:17 |
| 기타 실패 | 429 포함 비정상 응답은 일반 unknown, 예외도 unknown | 같은 파일:18–20 |
| 원본 해석 | `rate_limit.primary_window`, `secondary_window`, `limit_reached` | src/infra/codex-wham-parse.ts:6–14 |
| 창 크기 | primary/secondary의 순서가 아니라 `limit_window_seconds`로 창 분류 | src/infra/codex-wham-window.ts:10–15 |
| 사용률 | 유한 숫자인 `used_percent`, 아니면 null | 같은 파일:13 |
| 리셋 | `reset_at` Unix 초 우선, 없으면 조회 시각 + `reset_after_seconds` | src/infra/codex-wham-reset.ts:1–9 |
| 병렬 제공자 수집 | Codex/Claude 등 동시 조회 | src/infra/usage-collector.ts:10–18 |
| HTTP 라우트 | 요청마다 getReport(), no-store 응답 | src/ui/usage-route.ts:4–7 |
| 이전 성공 스냅샷 | safeFetch가 정상 결과를 보관, 인증 오류는 이전 값의 stale 폴백 가능 | src/infra/usage-safe-fetch.ts:6–14, src/infra/usage-auth-restore.ts:4–7 |

### 원본 JSON 구조 예시

아래는 `src/infra/codex-wham-parse.test.ts:5–18`의 합성 입력이다. 전체 upstream 응답 스키마를 증명하는 fixture는 아니다.

```json
{
  "rate_limit": {
    "limit_reached": false,
    "primary_window": {
      "used_percent": 20,
      "reset_at": 1793361600,
      "limit_window_seconds": 18000
    },
    "secondary_window": {
      "used_percent": 90,
      "reset_at": 1793880000,
      "limit_window_seconds": 604800
    }
  }
}
```

`reset_after_seconds` 대체 필드 예시는 `src/infra/codex-wham-parse.contract.test.ts:9–12`. primary가 주간 창인 경우도 테스트한다(85–94줄). 없는 창을 임의로 5시간/주간 0%로 만들면 안 된다. plan/credits/추가 버킷의 실제 WHAM 전체 구조는 이번에 실측하지 않았으며, biseo 파서는 해당 정보를 보존하지 않는다. 제공자 추가 시 원문은 먼저 보관하고 필요한 창을 별도로 정규화해야 한다.

### 429와 백오프

Codex 전용 fetch는 **Retry-After 해석, 지수 백오프, 호출 게이트, refresh를 구현하지 않는다**(`codex-wham-fetch.ts:8–22` 전체). safeFetch의 이전 값 복원은 호출 빈도 제어가 아니다. Claude 쪽에 존재하는 429 코드를 Codex에도 적용된 것으로 오해하면 안 된다. 사용률 100%의 quota 제한과 조회 HTTP 429도 별개다.

## 2. 이 Mac의 ~/.codex 확인

이 셸에는 CODEX_HOME 환경변수가 없었다. 기본 `~/.codex`를 조사했다. auth.json이 존재한다는 사실은 확인했지만 값은 출력·기록하지 않았다. 파일 존재만으로 현재 CLI/App의 활성 저장소나 인증 모드까지 확정하지 않는다.

### 최상위 파일·디렉터리 목록

```text
.codex-global-state.json
.codex-global-state.json.bak
.personality_migration
.sandbox_migration
.sqlite-maintenance.lock
.tmp/
app-server-control/
app-server-daemon/
auth.json
auth.lock
cache/
config.toml
generated_images/
goals_1.sqlite
goals_1.sqlite-shm
goals_1.sqlite-wal
herdr-agent-state.sh
history.jsonl
hooks.json
hooks.json.bak-20260930
hooks.json.bak-biseo
installation_id
log/
logs_2.sqlite
logs_2.sqlite-shm
logs_2.sqlite-wal
memories/
memories_1.sqlite
models_cache.json
packages/
plugins/
queue_1.sqlite
queue_1.sqlite-shm
queue_1.sqlite-wal
rules/
session_index.jsonl
session_index.jsonl.lock
sessions/
shell_snapshots/
skills/
sqlite/
state_5.sqlite
state_5.sqlite-shm
state_5.sqlite-wal
thread-writer-locks/
thread_history_1.sqlite
thread_history_1.sqlite-shm
thread_history_1.sqlite-wal
tmp/
tui-thread-reference-capabilities/
vendor_imports/
version.json
```

### auth.json JSON 키 이름만

```text
auth_mode
OPENAI_API_KEY
tokens
tokens.id_token
tokens.access_token
tokens.refresh_token
tokens.oauth_provenance
tokens.oauth_provenance.issuer
tokens.oauth_provenance.client_id
tokens.login_owner_id
tokens.account_id
last_refresh
```

그 외 JSON은 version.json에 `latest_version`, `last_checked_at`, `dismissed_version`; models_cache.json에 `fetched_at`, `etag`, `client_version`, `identity`, `models` 등의 메타데이터 키가 있다. 세션 JSONL·SQLite·로그에는 대화가 섞이므로 원문을 읽거나 보고서에 복사하지 않았다. 인증 데이터 값, 토큰, 계정 ID, JWT payload 값, 만료 날짜는 이 보고서에 기록하지 않았다.

### 만료와 갱신 소유자

auth.json에는 이번 확인 기준 `tokens.expires_at` 같은 명시적 키가 없었다. `last_refresh`는 access token 만료 시각 자체가 아니다. 필요하면 수집기 메모리에서 access JWT의 `exp`를 읽어 초→ms 변환하되, JWT 디코딩을 서명 검증으로 취급하지 않는다. opaque 토큰이나 exp 부재는 만료 미상으로 두고 서버 상태로 판정한다. 실제 TTL은 이번에 측정하지 않았다.

공식 문서는 Codex가 사용 중 토큰을 자동 갱신한다고 설명한다. 파일/keyring/auto/ephemeral 저장 옵션이 있으며, 파일 모드 경로는 CODEX_HOME 아래 auth.json이다. SSH 초기 로그인은 device code나 인증 캐시 전달을 지원하지만, device code는 별도 브라우저에서 사람의 승인이 필요하다. 따라서 완전 무인 초기 인증 수단으로 취급하면 안 된다. [공식 인증 문서](https://learn.chatgpt.com/docs/auth?surface=cli)

biseo의 수집 함수는 refresh_token을 읽지 않으며 auth.json도 쓰지 않는다. 즉 Codex CLI/인증 소유 프로세스의 갱신에 의존한다. 단순 PM2 프로세스 생존이나 조회 성공이 파일 토큰 갱신을 보장하지 않는다. 동일 refresh token을 여러 복사본에서 독립 갱신하는 설계는 회전 충돌 가능성이 있으므로 피하고, 자격 증명의 단일 갱신 소유자를 둔다(설계 권고).

## 3. 공식 app-server 대안

공식 app-server는 `account/rateLimits/read`와 변경 알림을 제공한다. `rateLimits` 단일 버킷과 `rateLimitsByLimitId` 다중 버킷을 구분하며, 각 창은 `usedPercent`, `windowDurationMins`, `resetsAt`(Unix 초)을 사용한다. 직접 WHAM raw와 필드명/구조가 다르므로 어댑터를 분리한다. 관리형 ChatGPT 인증에서는 `account/read`의 `refreshToken: true`로 refresh를 요청할 수 있지만 외부 토큰 모드에는 적용되지 않는다. [공식 app-server 문서](https://learn.chatgpt.com/docs/app-server)

PM2가 관리하는 app-server에 initialize/initialized 절차 후 JSON-RPC read만 보내는 방식이 후보이다. 추론 턴을 만들지 않고 사용량만 조회하고, 인증 소유자는 Codex로 유지할 수 있다. 다만 이번에는 프로세스를 실행하지 않았으므로 설치 버전의 메서드 지원·인증 모드·조회 중 자동 refresh 동작은 검증 항목이다. 공식 문서에서 소개한 app-server 인터페이스와 biseo의 직접 HTTP 방식 중 실제로 운영할 경로는 하나를 선택한다.

이는 Codex 구독 quota 조사다. OpenAI Platform 조직 Usage API나 API-key 과금 통계를 같은 값으로 대체하면 안 된다. 일반 ChatGPT 웹의 모든 모델별 메시지 한도를 이 결과가 포괄한다고도 보장하지 않는다.

## 4. 0.2 수집기에 Codex 제공자로 붙이는 방안

현재 코드 확인 근거(zzik 루트 기준):

- PM2 fork/instances 1: `collector/ecosystem.config.cjs:9–23`.
- 조립 루트의 300초 주기, KV·상태 경로: `collector/main.mjs:26–31`; 포트 조립:60–71; 중복 실행 스킵:97–118.
- Claude 파일 어댑터: `collector/infra/usage/credentials-file.mjs:13,29–35`.
- Claude 전용 URL·헤더 및 상태 분류: `collector/infra/usage/usage-client.mjs:9,24–42`.
- 게이트/백오프: `collector/app/usage/run-once.mjs:64–117`, `collector/domain/usage/backoff.mjs:19–28`.
- 봉투는 rawText와 이전 성공을 보존: `collector/domain/usage/envelope.mjs:47–76`; 현재 provider는 같은 파일의 반환부에서 Claude로 고정.
- Wrangler KV 쓰기는 keyName을 주입받아 --path 임시 파일로 실행: `collector/infra/usage/wrangler-kv-writer.mjs:65–95`.
- Worker 저장소는 현재 `usage:claude` 고정: `worker/infra/usage/kv-snapshot-store.ts:5`; 프론트 디코더도 provider === 'claude' 검사: `src/domain/usage/snapshot.ts:17`.
- 조사 시점 shared/usage-contract.ts에는 병합 충돌 표식이 있었다. 이번 조사는 파일 수정 없이 현재 상태를 읽은 것이며, 통합 시 최종 계약부터 확정해야 한다.

### 최소 변경 설계(미구현 메모)

1. provider 설정을 `claude | codex`로 명시하고 `runOnce`의 봉투 생성에 provider를 주입한다. 성공 이전 값·게이트·401 판정 정보를 제공자별로 완전히 격리한다.
2. `collector/infra/usage/codex-credentials-file.mjs`: CODEX_HOME 또는 명시 경로의 auth.json을 **매 실행 다시 읽고** tokens.access_token만 usage 포트에 전달한다. refresh_token은 수집기가 사용하지 않는다. 만료가 없으면 null 허용이 현재 선택 로직과 맞는지 테스트한다. 교체 중 JSON 파싱 실패는 no_credentials로 닫고 다음 주기에 재시도한다.
3. `codex-usage-client.mjs`: 고정 HTTPS WHAM URL, GET, Authorization, Accept: application/json, 10초 타임아웃, redirect: error(다른 호스트로 자격 증명을 보내지 않음). account_id 헤더 필요성은 별도로 실측하고 필요할 때 메모리에서만 주입한다. 인증 헤더/응답의 개인 식별 필드는 KV·로그에 쓰지 않는다. 전체 raw는 비밀·식별자 유무 확인 후 보존한다.
4. 200→ok+원문; 401/403→auth_required; 429→rate_limited+Retry-After; 5xx→upstream_error; fetch 실패→network_error. 기존 429 정책 `max(Retry-After, min(600×2^n,3600))`와 성공 시 게이트 초기화를 재사용한다. 마지막 성공 본문·시각을 보존하고 실패에서도 하트비트를 쓴다.
5. 별도 `usage:codex` KV 키, `codex-usage-state.json` 상태 파일, 제공자별 로그 또는 provider 필드를 쓴다. 기존 `usage:claude` 키를 덮어쓰지 않는다. 5분마다 두 제공자가 각각 KV를 쓰면 기본 576회/일이며 재시작/수동 쓰기는 별도다.
6. PM2는 같은 macOS 사용자로 Node/wrangler 절대 경로와 cwd·HOME·CODEX_HOME을 명시한다. auth 값 자체를 PM2 env/args/ecosystem/pm2 dump에 넣지 않는다. 재시작해도 백오프 상태를 복원하고 tick 중첩을 막는다. PM2 autorestart만으로 재부팅 후 자동 기동·Mac 절전 중 동작은 보장되지 않는다.
7. UI는 WHAM의 중첩 rate_limit을 별도 Codex 정규화기로 처리한다. window duration으로 5h/주간을 분류하고, 없는 창·추가 버킷은 유실시키지 않는다. 기존 Claude buildUsageView에 WHAM raw를 그대로 넣는 것으로 끝나지 않는다. Worker/API 계약도 제공자별 조회 또는 다중 스냅샷 응답으로 확장하고, 현재 Access JWT 보호는 유지한다.
8. 갱신 정책은 두 선택지: (A) Codex가 정상 사용 중 auth.json을 갱신하고 수집기는 읽기만 함 — 변경은 작지만 유휴 장기 운영 공백이 남음. (B) 공식 app-server 관리형 인증을 단일 소유자로 삼음 — headless 장기 운영 후보이나 별도 통합 테스트가 필요함. 수집기 자체 OAuth refresh를 첫 구현에 섞지 않는다.

### SSH·무인 운영 판정표

| 조건 | 판정 |
|---|---|
| 유효한 파일 인증 + HTTPS + 로그인된 wrangler | GUI 승인 없이 조회·KV 쓰기 설계 가능(이번에 실호출 검증 안 함) |
| macOS Keychain만 사용하며 잠금/승인이 필요 | 무인 수집에 부적합; 명시적 file 저장 정책 필요 |
| 파일 읽기 수집기만 있고 Codex가 오랫동안 실행되지 않음 | 만료 후 계속 최신 사용량을 받는 것은 보장 불가 |
| refresh 취소/로그아웃/계정 정책으로 재인증 필요 | PM2 재시작으로 해결되지 않음, 별도 기기에서 사람의 로그인 필요 |
| Wrangler OAuth 만료/갱신 실패 | upstream 성공과 별도로 KV 쓰기가 중단될 수 있음; 비대화식 실행 실패를 기록·알림 |

### 후속 검증

가짜 포트 TDD로 auth 파일 없음/깨짐, 만료, 회전 후 재읽기, 401 게이트 해제, 429 Retry-After, 제공자별 상태 격리, 정확한 KV 키, rawText 원문 보존을 확인한다. 첫 실측은 토큰을 argv/로그로 내보내지 않는 단일 dry-run으로 상태·키 이름·본문 해시만 확인하고, 성공 응답의 전체 개인 데이터 검토 후에만 fixture를 만든다. 설치 Codex에서 app-server 메서드와 refresh 소유 관계를 확인한 후 장기 유휴 테스트로 무인 운영 가능 범위를 확정한다.
