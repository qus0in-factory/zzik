# D1 REST writer의 전용 Wrangler OAuth 자격

`ZZIK_D1_AUTH=wrangler-oauth`는 자격 공급만 바꾸며 기존 REST query/batch sender를 유지한다. 기본 `api-token`과 `ZZIK_STORE=postgres` 경로는 바꾸지 않는다. PG에서는 OAuth 파일 읽기·명령 실행이 없다. 이번 patch는 운영 env/PM2/플래그를 변경하지 않는다.

D1은 기존 ZZIK_D1_ACCOUNT_ID·ZZIK_D1_DATABASE_ID가 필요하다. OAuth에서는 ZZIK_D1_API_TOKEN이 필요 없다. 수집기 전용 `ZZIK_D1_OAUTH_PROFILE`의 기본값은 `zzik-collector`다. 사람 CLI의 ambient CLOUDFLARE_AUTH_PROFILE이나 디렉터리 활성 profile로부터 이 값을 추정하지 않는다. default/staging 및 경로 문자는 거부한다.

파일은 legacy ~/.wrangler 우선, 없으면 macOS/XDG config의 `.wrangler/config/<collector-profile>.toml`이다. refresh 자식에도 **같은 이름**을 CLOUDFLARE_AUTH_PROFILE로 명시한다. Wrangler4.159.0에서 환경 profile은 디렉터리 활성 profile보다 우선한다. whoami는 --profile을 거부하므로 `whoami --json`과 환경 변수를 사용한다. 전용 profile이 없으면 사람 default 자격으로 fallback하지 않는다.

최초 로그인은 사용자가 브라우저에서 승인해야 한다. agent는 로그인하지 않는다. 저장소 설치가 있는 release에서 다음을 사용한다:

```sh
(umask 077; CLOUDFLARE_AUTH_USE_KEYRING=false pnpm exec wrangler auth create zzik-collector)
```

`wrangler login --profile`은 이 버전에서 지원하지 않는다. auth create는 named profile의 최초 로그인/재인증이며 디렉터리에 activate할 필요는 없다. 위 환경 설정은 이 로그인만 plaintext 저장으로 하며 전역 keyring preference를 변경하지 않는다. 기존 사람 default 자격을 복사해 전용 profile을 만들지 않는다.

각 요청 전 파일을 읽고 만료60초 전부터 갱신한다. 유효 토큰은 단순 Wrangler 명령으로 갱신되지 않으므로, access/refresh token·scope를 보존한 채 expiry 메타만 과거로 atomic rename/fsync한다(임시 파일0600). 최대10초·비대화형 whoami가 실제 갱신·저장을 수행하고, 파일을 다시 읽어 새 토큰과 잔여 유효 시간을 확인한다. 프로세스 전역 single-flight/직렬 lane은 동시 성공과 실패를 공유한다. 갱신 도중 종료되면 다음 호출이 만료 상태를 보고 갱신할 수 있으며 오래된 백업으로 덮어쓰지 않는다.

일시적인 파일 파싱/읽기·선제 refresh 네트워크/timeout 등 **credentials.get 실패**는 연속1·2회에 retry/60000ms를 반환해 기존 sender backoff에 맡긴다. 연속3회는 기존 authStopped에 기록한다. 성공적으로 자격을 읽으면 실패 횟수를0으로 되돌린다. 횟수는 프로세스 메모리에만 둔다. 시작 시 reconciliation 실패의 기존 종료 동작은 변경하지 않는다.

HTTP401은 refresh 뒤 동일 batch를 새 토큰으로 한 번만 다시 보낸다. 이 경우 refresh 실패·재401·403은 기존대로 즉시 auth stop과 sender 알림으로 이어진다. 403은 응답에 따른 refresh를 하지 않는다. 재요청도 기존1요청/초·canRequest·15초 HTTP deadline을 거치며 operation id·seq·payload·ack 계약을 바꾸지 않는다.

Node와 Wrangler JS, 자식 cwd는 import.meta.url 기준 절대 경로다. 자식 환경은 HOME/PATH/XDG/TMP/locale 및 네트워크 인증서·proxy 설정만 허용하고, 고정 CI·production·전용 profile·plaintext·로그 비활성 값을 추가한다. DB_URL·Discord webhook·API token/key·계정 ID·임의 OAuth endpoint override는 상속하지 않는다. stdout/stderr를 캡처 후 폐기하며 Wrangler 디스크 로그·telemetry를 끈다. 토큰 원문은 ledger/control/알림/로그에 넣지 않고 기존 SHA-256 credentialKey만 유지한다.

전용 profile은 사람 default CLI와의 갱신 경쟁을 분리한다. 같은 전용 profile을 다른 독립 프로세스에서 동시에 갱신하는 분산 잠금은 아니므로 수집기 state lock을 유지하고 별도 CLI로 해당 profile을 동시 갱신하지 않는다.

검증은 fake file/refresh/REST와 실제 Wrangler4.159.0의 격리 HOME·synthetic profile·로컬 OAuth 서버로 수행했다. 후자는 profile 우선순위, 비TTY·CI=true의 refresh와 지정 파일 저장/재읽기, default 불변을 확인했다. 실제 운영 전용 profile은 사용자 로그인 전이므로 그 자격으로 Cloudflare refresh 성공·장기 운용을 검증했다고 주장하지 않는다. 기존 실제 scratch OAuth Bearer/refresh 검증과도 구분한다. release frozen install 후 Wrangler4.159.0 존재를 확인했다. 운영 전환은 별도 승인 대상이다.
