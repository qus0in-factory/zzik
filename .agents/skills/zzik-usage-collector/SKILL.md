---
name: zzik-usage-collector
description: zzik 수집기 PM2 설치·재시작·장애 대응 시 사용. P3 Postgres 단독 저장소·ZZIK_STORE=postgres, 6개 제공자·900초 주기, DB_URL·보존 정리·저장 실패·토큰 만료 게이트·dry-run 안전 절차.
---

# zzik usage collector 운영

ADR 0.2/0.3/0.4/0.6과 docs/adr/0.5-postgres-storage.md가 정본이다. P0/P1/P2/P3 게이트·배포·롤백은 zzik-deploy 스킬 참조.

## 전제

- SSH 무인 운영. Keychain/GUI 승인 없음. 자격 증명은 제공자별 파일을 읽기만 하며 수집기는 refresh token을 사용하거나 토큰을 갱신하지 않는다.
- 운영 인스턴스는 .worktree/release의 PM2 zzik-usage-collector 하나다. 개발 워크트리의 실제 --once/상주 실행 금지.
- P3 구현 완료: Postgres 단독 저장소다. ecosystem은 ZZIK_STORE=postgres이며 미지정 시에도 postgres다. kv/both 등 다른 값은 종료 78로 거부한다. KV writer/fanout은 없다.
- 제공자는 claude,codex,antigravity,opencode,grok,ollama 6개이며 ZZIK_AGY_CLI_PATH는 실행 가능한 agy 절대경로를 유지한다. Antigravity는 API·토큰 파일이 아니라 `agy -p /quota` 출력만 수집한다(source=cli).
- 운영 반영 전 release가 P2 코드이면 both가 남아 있을 수 있다. P3 반영 시 ecosystem 기반 --update-env·save로 postgres를 적용하고 runtime/saved 설정을 값 노출 없이 대조한다.
- DB_URL은 해당 체크아웃의 gitignore .env에서 Node --env-file로 주입한다. ecosystem node_args를 사용하며 PM2 env에 연결 문자열을 복제해 기록하지 않는다. DB_URL/호스트·비밀번호가 포함될 수 있는 오류 원문을 출력하지 않는다.
- DB max:1, idle_timeout:5, connect_timeout:10, prepare:false. 900초 주기. Free 예산을 위해 300초로 되돌리지 않는다.
- 이력은 상태/본문 hash 변경 때만 저장하고 30일 이전 이력을 하루 1회 정리한다. 별도 cron·keep-alive 없음.

## 승인 후 설치·재시작

- release에서 pnpm install --frozen-lockfile. 로컬 .env가 있고 DB_URL이 있는지는 값 없이 boolean으로 확인한다. .env 내용이나 키 목록 전체를 cat하지 않는다.
- 새 등록: pm2 start collector/ecosystem.config.cjs, pm2 save.
- 환경 변경 반영: pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env 후 pm2 save. 또는 기존 인스턴스의 명시적 환경 override와 --update-env를 사용하되 ecosystem 추적값과 일치하는지 확인한다.
- DB_URL·ZZIK_AGY_CLI_PATH 변경은 기존 프로세스 재시작이 필요하다. Node --env-file을 다시 읽도록 한다.
- 재시작해도 게이트/카운터는 유지된다. 상태를 지워 게이트를 우회하지 않는다.

## 상태·저장 확인

- 로그: ~/Library/Logs/zzik/usage-collector.log. pm2 logs zzik-usage-collector --lines 20 --nostream.
- 제공자별 상태: ~/Library/Application Support/zzik/usage-state.provider.json. 이전 봉투/게이트 유지. 하루 1회 정리의 lastPruneAt은 정리 상태에 남는다.
- agy 토큰 저장소(file/keychain) 점검: Antigravity 로그의 `source=cli`와 CLI 실패 진단만 보고, 토큰 파일·Keychain 값은 읽지 않는다. 저장소가 바뀌어도 수집기는 agy를 신뢰한다.
- DB 상태는 provider/status/run_at/fetched_at 정도만 제한 조회한다. envelope 전문·DB_URL·자격 증명을 출력하지 않는다.
- scripts/usage-live-shape.sh provider로 DB 형상 확인. 이 스크립트가 내부적으로 사용하는 fetch 출력은 원문이므로 따로 실행해 터미널/파일에 저장하지 않는다.
- kvOk/kvReason·kv= 표기는 기존 로그와의 호환 이름이며 Postgres 저장 결과만 뜻한다. kvOk=true는 Postgres 쓰기 성공이다. 실패하면 DB_URL 존재 여부·Neon 한도·연결·마이그레이션을 점검한다. 오류는 안전한 code/name만 기록한다.
- usage_snapshot은 정확히 6행이고 각 envelope의 jsonb_typeof가 object인지 확인한다. provider/status/run_at 갱신과 정상 저장 로그를 대조한다.
- prune 실패는 주기 종료 코드를 실패시키지 않지만 반복되면 DB 연결·보존 용량을 확인한다.

## dry-run

- 개발 체크아웃에서는 --dry-run + 합성 파일/없는 경로만 사용한다. --credentials-file은 --provider 및 --dry-run과 함께 사용.
- 실제 자격 증명 dry-run은 명시적 승인/실측 지시가 있을 때만 1회. 반복 요청으로 인증/429 게이트를 우회하지 않는다.
- dry-run은 DB 연결·DB/상태/로그 쓰기·보존 정리를 하지 않으며 DB_URL 없이도 합성 재현이 가능하다.

## 증상 대응

| 상태 | 대응 |
|---|---|
| token_expired | 해당 제공자 앱이 갱신하면 다음 주기에 자동 해제. 수집기에서 직접 refresh 없음 |
| auth_required/auth_rejected | 제공자 앱으로 갱신, expiresAt 변경 자동 해제 관측. 게이트 삭제/반복 --once 금지 |
| no_credentials | 파일 존재만 값 없이 확인 후 제공자 앱 로그인/갱신 대기(Antigravity는 CLI 수집이라 해당 없음) |
| upstream_error(diag=cli_failed/empty_quota) | agy 경로·로그인 상태·`/quota` 출력 형식을 확인. 수집기가 로그인을 유발하지 않는다 |
| rate_limited | Retry-After/백오프 대기. 추가 실제 호출 금지 |
| upstream_error/network_error | 로그의 안전한 진단 확인, 다음 주기 재시도 |
| kvOk=false, Postgres 저장 실패 | DB_URL 존재 여부·Neon 컴퓨트 한도·연결 및 마이그레이션 확인. 오류 원문을 출력하지 않음 |
| runAt 45분 이상 정지 | PM2 상태와 900초×3 stale 기준 확인, 승인된 재시작 절차 적용 |

## 금지

운영 재시작·DB migration·Worker secret 주입·배포는 해당 지시가 있을 때만 실행한다. 실제 자격 증명·DB_URL·refresh token·이메일·계정 ID 출력 금지. 상태/게이트 삭제, 개발 --once 실쓰기, 승인 없는 DB seed/삭제, KV 네임스페이스 삭제 금지. **워커는 agy 등 운영 자격 증명을 건드리는 CLI(로그인·재인증·토큰 갱신 유발)를 실행하지 않는다.**
