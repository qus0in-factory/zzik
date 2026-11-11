# biseo의 Claude 사용량(usage) 수집 방식 조사

- 대상 레포: https://github.com/qus0in-factory/biseo (클론 위치: `/tmp/biseo`)
- 요약: biseo는 다중 프로바이더(Claude/Codex/OpenCode-Go/Grok/Ollama 등) 사용량 모니터. Claude 사용량은 **Anthropic 공식 OAuth usage 엔드포인트를 로컬 Node 백엔드가 직접 fetch**하고, **Cloudflare Worker는 그 결과를 로컬 백엔드에서 폴링해 D1에 저장**하는 2단 구조다.

---

## 1. 데이터 출처

**Anthropic 공식 OAuth usage 엔드포인트를 HTTP fetch로 호출**한다.

- 엔드포인트: `https://api.anthropic.com/api/oauth/usage`
  - 오버라이드 환경변수: `BISEO_CLAUDE_USAGE_URL`
  - 정의: `src/domain/usage-endpoints-base.ts:5`
- statsig, Claude Code JSONL 로그 파싱, `claude` CLI 파싱, 웹 스크래핑은 Claude usage에 대해 사용하지 않는다.
- 로컬 파일 접근은 2가지 용도뿐:
  - **토큰 읽기**: `~/.claude/.credentials.json` — `src/infra/claude-oauth-token.ts:7`
  - **결과 스냅샷 저장**: `{BISEO_STATE_DIR:-data}/claude-usage.json` — `src/infra/claude-snapshot-default.ts:6-9` (경로는 `BISEO_CLAUDE_SNAPSHOT_PATH` 또는 `config/claude-oauth.json`의 `snapshotPath`로 변경 가능: `src/infra/claude-snapshot-path.ts:11-27`)
- 참고: `~/.claude/projects` JSONL을 읽는 코드(`src/domain/claude-session-model.ts:8` 등)가 있으나 이는 Herdr pane 모델명 감지용이지 usage 수집이 아니다.

## 2. 인증 방식과 필요한 비밀값

**Claude Code의 OAuth 액세스 토큰을 로컬 파일에서 읽어 Bearer 헤더로 사용**한다(API key 아님).

- 토큰 파일: 기본 `~/.claude/.credentials.json`, 오버라이드 환경변수 `BISEO_CLAUDE_CREDENTIALS_PATH`
- 필요한 비밀값: 파일 내 JSON 키 **`claudeAiOauth.accessToken`** (실제 값은 레포에 없고 런타임에 파일에서 읽음)
  - `src/infra/claude-oauth-token.ts:5-12`:
    ```ts
    export async function readClaudeToken(): Promise<string | null> {
      try {
        const p = process.env.BISEO_CLAUDE_CREDENTIALS_PATH || join(homedir(), '.claude', '.credentials.json')
        return JSON.parse(await readFile(p, 'utf8')).claudeAiOauth?.accessToken ?? null
      } catch { return null }
    }
    ```
- 요청 헤더(Anthropic OAuth 전용 beta 활용):
  - `Authorization: Bearer <accessToken>`
  - `anthropic-beta: oauth-2025-04-20`
  - `Accept: application/json`
- 토큰이 없으면 `auth_required` 실패 처리 (`src/infra/claude-oauth-fetch.ts:13`), `401/403`도 `auth_required` (`src/infra/claude-oauth-http.ts:6-13`)
- **Worker→로컬 백엔드 간 인증은 별도**: PASETO v4 공개키 서명 서비스 토큰. Worker가 `SERVICE_PASETO_SECRET`(wrangler secret, `k4.secret.…` 형식)으로 서명(`worker/infra/service-token.ts:7-22`, issuer `biseo`, audience `biseo-service`, TTL 300초 — `wrangler.jsonc:32-35`) → 로컬 백엔드가 공개키 파일로 검증(`src/ui/service-auth.ts:2-14`).

## 3. 요청·응답 형식

**요청** — GET, Bearer 토큰, 5초 타임아웃(`BISEO_USAGE_TIMEOUT_MS`, 기본 5000):

- `src/infra/claude-oauth-request.ts:5-10`:
  ```ts
  export type ClaudeHttpResult = { status: number; retryAfter: string | null; data: unknown }
  export async function requestClaudeUsage(token: string): Promise<ClaudeHttpResult> {
    const headers = { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', Accept: 'application/json' }
    const res = await fetch(getUsageEndpoints().claude, { headers, signal: AbortSignal.timeout(getUsageTimeoutMs()) })
    const data = await res.json().catch(() => null)
    return { status: res.status, retryAfter: res.headers.get('retry-after'), data }
  }
  ```
- 상태 코드 매핑(`src/infra/claude-oauth-http.ts:6-13`): `200`→파싱, `429`→`rate_limited` + `retryAt`(retry-after 헤더 기반 백오프), `401/403`→`auth_required`, 기타→`upstream_error`

**응답(raw) 구조와 파싱 규칙** — 테스트가 보여주는 live 응답 예시(`src/infra/claude-oauth-parse.test.ts:46-56`):

```ts
const raw = {
  five_hour: { utilization: 37, resets_at: '...' },
  seven_day: { utilization: 12, resets_at: '...' },
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 5, resets_at: '...' },
  extra_usage: { utilization: 5 }
}
// → windows 2개(primary/secondary), metrics ['five_hour','seven_day','seven_day_sonnet','extra_usage']
```

- 파싱 규칙(`src/infra/claude-oauth-items.ts:5-19`): 최상위 `five_hour`/`seven_day`는 각각 primary/secondary **window**가 되고, **나머지 모든 키는 `utilization`(number) 또는 `resets_at`(string)을 가진 객체면 전부 metric으로 수집**.
- 각 항목 필드(`src/infra/claude-oauth-window.ts:3-8`, `claude-oauth-metric.ts:3-22`): `utilization`(0–100 %사용률) → `usedPercent`/`used`, `resets_at`(ISO) → `resetsAt`, `remaining = 100 - utilization`, `limit = 100`. metric 라벨 맵: `five_hour`→'5-Hour Limit', `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps`, `seven_day_cowork` 등.
- 내부 타입(`src/domain/usage-types.ts:1-36`):
  ```ts
  export interface UsageMetric { id: string; label: string; unit: 'percent'|'credits'|…; used: number|null;
    limit: number|null; remaining: number|null; resetsAt: string|null; startsAt?: string|null }
  export interface WindowUsage { window: string; usedPercent: number|null; resetsAt: string|null;
    checkedAt: string|null; limitReached: boolean; source: string|null }
  export interface ProviderUsage { provider: string; state: 'available'|'limited'|'unknown'; metrics: UsageMetric[];
    windows: WindowUsage[]; source?: string|null; checkedAt?: string|null; reason?: string|null; retryAt?: string|null }
  ```
- `state` 판정(`src/infra/claude-oauth-parse.ts:10-14`): metric 중 `used >= 100`이고 reset이 아직 안 지난 것이 하나라도 있으면 `limited`.

## 4. 실행 환경 제약

**Claude usage 수집 자체는 로컬 Node 백엔드 전용.**

- 이유: `node:fs`(`readFile`/`writeFileSync`/`renameSync`/`mkdirSync`), `node:os`(homedir), `node:path` 의존(`src/infra/claude-oauth-token.ts:1-3`, `claude-snapshot-disk.ts:1`, `claude-snapshot-path.ts:1-2`). Claude Code 토큰 파일(`~/.claude/.credentials.json`을 `homdir()` 기준 상대 경로로 읽음)과 스냅샷 파일 쓰기가 파일 시스템을 직접 쓴다. 응답 파싱(fetch+JSON)과 백오프·스냅샷 저장 전체 흐름이 이 의존에 묶여 있다.
- 브라우저/CORS 의존은 없음 — 전부 서버사이드(fetch는 plain fetch, 헤더는 CORS 사전 요청 무관한 서버사이드 호출).

**Cloudflare Workers에서의 가능 여부 — biseo의 실제 설계는 'Worker 폴링' 방식:**

- Worker(`worker/`, `wrangler.jsonc`)는 Claude 엔드포인트를 직접 호출하지 **않고**, 매분 cron으로 로컬 백엔드의 `GET /herdr/usage`를 폴링해 D1에 저장:
  - cron 매 1분: `wrangler.jsonc:54-56` (`"crons": ["* * * * *"]`), D1 바인딩 `BISEO_DB` (`wrangler.jsonc:57-64`)
  - `worker/scheduled.ts:8-21` → `worker/scheduled-sync.ts:14` → `worker/scheduled-usage.ts:6-11`:
    ```ts
    export async function syncUsage(db:D1Database,env:CronEnv){
      const r=await callUpstreamJson<unknown>(env,'/herdr/usage','GET',undefined,crypto.randomUUID())
      if(!r.ok)return false
      await upsertUsage(db,parseUsage(r.data))
    }
    ```
  - `callUpstreamJson`(`worker/infra/herdr-upstream-http.ts:7-20`)은 ky+Bearer 서비스 토큰(순수 fetch 계열) → Workers에서 동작 가능. 로컬 백엔드는 Tailscale funnel로 외부 노출(`FUNNEL_BASE_URL`/`FUNNEL_HEALTH_URL`, `worker/infra/herdr-upstream-config.ts:13-20`), usage upstream 정책은 타임아웃 30초·retry 0(`worker/infra/upstream-policy.ts:6-7`, `runtime-settings.ts:23`).
- **Workers가 Claude 엔드포인트를 '직접' 호출하는 것의 제약**: Workers에는 로컬 파일 시스템이 없어 `~/.claude/.credentials.json`을 읽을 수 없다. 가능하려면 OAuth 토큰을 별도 비밀(wrangler secret 등)로 넣어 fetch만 하면 되는데, 요청 자체는 plain GET+헤더라 Workers fetch로 기술적으로는 가능. 다만 biseo는 토큰을 시크릿 복제하지 않고 로컬 수집+Worker 폴링 구조를 채택했다(토큰 갱신·429 백오프·스냅샷이 로컬에 있음).
- Worker에도 claude 관련 로직이 하나 있음: `worker/app/usage-claude-stale.ts:4-13` — `unknown`이 된 claude row를 reset이 유효한 이전 D1 값으로 되살림(source `claude-stale`).

## 5. 관련 파일 경로와 핵심 코드 위치

**수집(로컬 백엔드, `src/`)**

| 역할 | 파일:줄 |
|---|---|
| fetch 오케스트레이션(백오프 게이트→토큰→요청→429/성공 적용) | `src/infra/claude-oauth-fetch.ts:8-20` |
| OAuth 토큰 파일 읽기 | `src/infra/claude-oauth-token.ts:5-12` |
| HTTP 요청(GET+헤더+타임아웃) | `src/infra/claude-oauth-request.ts:5-10` |
| 상태코드 매핑 | `src/infra/claude-oauth-http.ts:6-13` |
| 응답 파싱(raw→windows+metrics) | `src/infra/claude-oauth-parse.ts:5-15`, `claude-oauth-items.ts:5-19`, `claude-oauth-window.ts:3-8`, `claude-oauth-metric.ts:3-22` |
| 429 백오프/retry-after/게이트 | `src/infra/claude-oauth-gate.ts:9-23`, `claude-oauth-backoff.ts`, `claude-retry-after.ts:1-6`, `claude-429-wait.ts`, `claude-oauth-floor.ts:10-21` |
| 백오프 설정값 | `src/infra/claude-oauth-config.ts:12-23` + `config/claude-oauth.json`(initialMs 60000, maxMs 900000, factor 2, floorMs 600000) |
| 스냅샷 원자적 저장(0700/0600, tmp→rename) | `src/infra/claude-snapshot-store.ts:16-24`, `claude-snapshot-disk.ts:16-24` |
| 스냅샷 경로 결정 | `claude-snapshot-path.ts:11-27`, `claude-snapshot-default.ts:6-9` |
| stale 복원(resetsAt까지 유효) | `claude-snapshot-stale.ts:3-12`, 만료 필터 `claude-usage-open.ts:9-18` |
| 백그라운드 폴링(60초 주기, in-flight 병합) | `claude-usage-poll.ts:4-10`(`setInterval` unref), `claude-usage-refresh.ts:18-24`, 메모리 캐시 `claude-usage-cache.ts:5-11` |
| 부팅 시 폴링 시작 | `src/index.ts:15` (`startClaudeUsagePoll()`) |
| 조회 우선순위(폴링 결과 → 스냅샷) | `claude-usage-read.ts:8-18` |
| 프로바이더 수집기 통합 | `src/infra/usage-collector.ts:10-19` (claude는 `readClaudeUsage`) |

**노출·저장·표시 파이프라인**

1. **수집**: 로컬 백엔드 부팅 → 60초 폴링 + 화면 요청 시 coalesce → `https://api.anthropic.com/api/oauth/usage` 호출 → `parseClaudeUsage` → 성공분만 `data/claude-usage.json`에 원자적 저장 + 메모리 캐시
2. **로컬 API**: `GET /herdr/usage` — `src/ui/executor-routes.ts:9` → `src/ui/usage-route.ts:4-9` (`UsageCollector.getReport()` JSON, `Cache-Control: no-store`). 이 경로 조회가 claude upstream 재호출을 유발하지 않음(`src/infra/claude-usage-route.test.ts:6-17`). 서비스 인증 필요(`src/ui/app-routes.ts:16`).
3. **Worker 동기화**: 매분 cron → PASETO Bearer로 로컬 `/herdr/usage` 폴링 → `worker/app/usage-sync.ts:4-10` → `worker/app/usage-rows.ts:5-16`·`usage-window.ts`로 행 변환 → `worker/infra/d1-usage-write.ts:9-15`가 stale 병합 후 D1 `usage_snapshots` 전체 교체(`worker/migrations/0002_usage.sql`, 0004에서 metric 컬럼 추가)
4. **브라우저 API**: `worker/ui/usage-route.ts:8-17` `GET /api/usage` — 매번 upstream 재시도, 성공 시 D1 갱신, 실패 시 D1 마지막 스냅샷 + `stale` 플래그 + `lastSuccessAt`. `worker/app/usage-group.ts:4-15`로 행→프로바이더 그룹화
5. **프론트엔드**: `web/infra/usageApi.ts:5` (`ky.get('/api/usage')`) → `web/app/useUsage.ts:8-20` → `web/ui/UsagePanel.tsx`, `UsageDashboard.tsx`, `UsageModalBody.tsx`. `web/domain/usage-cache.ts:11-15`가 `source: 'claude-cache'`/`'claude-stale'` 감지로 "오래된 값 + 마지막 성공 시각" 표시. `web/domain/usage-metric-name.ts:6`이 claude metric id(`five_hour`/`seven_day*`)를 primary/secondary 창으로 정규화

**운영 문서**: `docs/ops/current-operations.md:67-90` — 429 백오프·스냅샷 정책·stale 표시·리프레시 버튼이 백오프를 우회하지 않는다는 명세
