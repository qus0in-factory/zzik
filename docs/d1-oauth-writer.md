# D1 REST writer의 Wrangler OAuth 자격 공급

`ZZIK_D1_AUTH=wrangler-oauth`는 D1 REST writer의 자격 공급만 바꾼다. sender를 CLI file import로 바꾸지 않는다. 기본 `api-token` 공급자는 유지하며, `ZZIK_STORE=postgres` 경로에서는 OAuth 파일 읽기·명령 실행이 없다. 이번 patch는 운영 env/PM2/플래그를 변경하지 않는다.

D1 모드는 기존 `ZZIK_D1_ACCOUNT_ID`·`ZZIK_D1_DATABASE_ID`가 필요하다. OAuth 모드에서는 `ZZIK_D1_API_TOKEN`이 필요 없으며 읽지도 않는다. 로컬 사용자의 Wrangler default plaintext profile을 쓴다. legacy `~/.wrangler` 디렉터리가 있으면 우선하고, 없으면 macOS/XDG config의 `.wrangler/config/default.toml`을 사용한다. 다른 profile이나 keyring 형식은 지원 범위 밖이며 파일이 없거나 손상되면 안전하게 정지한다.

파일의 access token은 메모리에서 Authorization 헤더에만 쓴다. 각 요청 전 파일을 읽고, 만료60초 전부터 갱신한다. 아직 유효한 토큰은 단순 Wrangler 명령으로 갱신되지 않으므로, 토큰·refresh token·scope는 그대로 두고 expiry 메타만 과거로 atomic rename/fsync한다(임시 파일0600). 그 뒤 최대10초의 비대화형 `wrangler whoami --json`을 실행해 Wrangler 자체 갱신·저장에 맡기고 파일을 다시 읽는다. 새 토큰과 충분한 잔여 시간이 확인돼야 계속한다. 메타 표시 뒤 종료되면 다음 Wrangler 호출도 만료 상태로 보고 정상 갱신을 시도할 수 있다. 오래된 자격 백업으로 덮어쓰지 않는다.

동시 만료/401 관측은 프로세스 전역 single-flight 및 직렬 lane을 공유하며 실패도 공유한다. 파일이 이미 다른 새 토큰으로 바뀌었으면 추가 갱신 없이 재읽은 값을 쓴다. 파일 갱신 전 비교로 관측 가능한 변경 충돌은 거부한다. 외부 Wrangler 프로세스는 이 lane을 공유하지 않으므로 **같은 사용자/default profile의 운영 갱신과 다른 Wrangler 작업은 직렬화**한다. 여러 호스트·독립 프로세스를 조정하는 분산 잠금은 아니다.

401은 갱신 후 정확히 같은 batch를 새 토큰으로 한 번만 다시 보낸다. 재요청도 기존 전역1요청/초 lane과 canRequest를 거친다. 갱신 실패·다시401·403은 기존 auth stop과 sender 알림으로 이어지고 자동 루프를 돌지 않는다. 성공한 갱신 자체는 operation id·write_seq·payload·ack 계약을 바꾸지 않는다. 403은 권한 부족일 수 있어 갱신하지 않는다.

Wrangler 자식의 stdout/stderr는 캡처 후 폐기하고 디스크 로그·telemetry를 비활성화한다. API token/key, DB_URL, profile/environment override를 제거해 default OAuth만 사용한다. OAuth 토큰이나 refresh token을 출력하는 명령은 쓰지 않는다. ledger·control·알림·로그에 토큰 원문을 넣지 않는다. 기존 credentialKey는 토큰의 SHA-256이며 원문이 아니다. 실패 결과는 안전 reason만 반환한다.

검증은 fake file/refresh 실행기·기존 REST 가짜 endpoint로 만료, single-flight 성공/실패, 401 재시도/상한, 403, 안전 정지를 확인한다. 별도 승인된 scratch D1에서 실제 OAuth Bearer query/batch200, 만료 메타 표시 후 명령1회 갱신·파일 재읽기·새 Bearer200을 확인했다. 이것은 scratch의 기능 검증이며 장기 무인 운영, 자격 취소 후 자동 복구, 외부 CLI 동시 갱신, 운영 DB 전환 완료를 보장하지 않는다. scratch는 삭제했고 운영 D1·수집기에는 이 patch를 실행하지 않았다.
