---
name: zzik-usage-collector
description: zzik 수집기 PM2 설치·재시작·장애 대응 시 사용. Postgres+KV 이중 쓰기(`ZZIK_STORE=both`, P2 완료·P3 KV 제거 미진행), 6개 제공자(claude/codex/antigravity/opencode/grok/ollama), 900초 주기, ZZIK_AGY_CLI_PATH, DB_URL·보존 정리·저장 실패·토큰 만료 게이트·dry-run 안전 절차.
---

# zzik usage collector 운영

ADR 0.2/0.3/0.4/0.5/0.6과 docs/adr/0.5-postgres-storage.md가 정본이다. 배포·검증·게이트는 zzik-deploy 스킬 참조.

## 전제

- SSH 무인 운영. Keychain/GUI 승인 없음. 자격 증명은 제공자별 파일·설정을 읽기만 하며 수집기는 refresh token을 직접 사용하거나 토큰을 임의 갱신하지 않는다.
- 운영 인스턴스는 `.worktree/release`의 PM2 `zzik-usage-collector` 하나다. 개발 워크트리의 실제 `--once`/상주 실행 금지.
- 저장소: P2 완료·P3 미진행: Worker는 Postgres(Neon)에서 읽고, 수집기는 `ZZIK_STORE=both`로 KV와 Postgres에 이중 쓰기한다(KV 제거는 P3에서). 이 스킬의 KV 관련 절차는 P3 전까지 유효하다. 저장 대상은 Postgres(`usage_snapshot`, `usage_event`)와 Cloudflare KV다.
- 대상 제공자 (6개): `claude`, `codex`, `antigravity`, `opencode`, `grok`, `ollama`. 매 주기마다 `usage_snapshot`에 6개 행이 갱신된다.
- Antigravity CLI: Antigravity의 Argon 주간 한도는 CLI 러너(`agy -p /quota`)로 수집한다. `ZZIK_AGY_CLI_PATH` 환경변수(기본값 `agy`)를 지정하거나 PM2 환경 PATH에 `agy`가 포함되어야 한다. `ZZIK_AGY_CLI_ENABLED=0`이면 CLI 호출을 건너뛰고 Argon 카드만 안전하게 생략된다.
- DB_URL은 해당 체크아웃의 gitignore `.env`에서 Node `--env-file`로 주입한다. ecosystem `node_args`를 사용하며 PM2 env에 연결 문자열을 복제해 기록하지 않는다. DB_URL/호스트·비밀번호가 포함될 수 있는 오류 원문을 출력하지 않는다.
- DB 설정: max:1, idle_timeout:5, connect_timeout:10, prepare:false. 900초 주기. Free 예산(100 CU-h/월)을 위해 300초로 되돌리지 않는다.
- 이력은 상태/본문 hash 변경 때만 저장하고 30일 이전 이력을 하루 1회 정리한다. 별도 cron·keep-alive 없음.

## 승인 후 설치·재시작

- release에서 `pnpm install --frozen-lockfile`. 로컬 `.env`가 있고 DB_URL이 있는지는 값 없이 boolean으로 확인한다. `.env` 내용이나 키 목록 전체를 cat하지 않는다.
- 새 등록: `pm2 start collector/ecosystem.config.cjs`, `pm2 save`.
- 환경 변경 반영: `pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env` 후 `pm2 save`.
- DB_URL 및 `ZZIK_AGY_CLI_PATH` 변경은 기존 프로세스 재시작이 필요하다. Node `--env-file` 및 환경변수를 다시 읽도록 한다.
- 재시작해도 게이트/카운터는 유지된다. 상태를 지워 게이트를 우회하지 않는다.

## 상태·저장 확인

- 로그: `~/Library/Logs/zzik/usage-collector.log`. `pm2 logs zzik-usage-collector --lines 20 --nostream`.
- 제공자별 상태: `~/Library/Application Support/zzik/usage-state.<provider>.json`. 이전 봉투/게이트 유지. 하루 1회 정리의 `lastPruneAt`은 정리 상태에 남는다.
- DB 상태: `provider`, `status`, `run_at`, `fetched_at` 등 제한된 메타데이터만 조회. `usage_snapshot` 테이블 6행의 `run_at`이 900초(15분)마다 전진하는지 확인. envelope 전문·DB_URL·자격 증명을 출력하지 않는다.
- 실데이터 형상 확인: `scripts/usage-live-shape.sh [claude|codex|antigravity|opencode|grok|ollama]`로 Postgres envelope 형상 확인. 이 스크립트가 내부적으로 사용하는 fetch 출력은 원문이므로 따로 실행해 터미널/파일에 저장하지 않는다.
- prune 실패는 주기 종료 코드를 실패시키지 않지만 반복되면 DB 연결·보존 용량을 확인한다.

## dry-run

- 개발 체크아웃에서는 `--dry-run` + 합성 파일/없는 경로만 사용한다. `--credentials-file`은 `--provider` 및 `--dry-run`과 함께 사용.
- 실제 자격 증명 dry-run은 명시적 승인/실측 지시가 있을 때만 1회. 반복 요청으로 인증/429 게이트를 우회하지 않는다.
- dry-run은 DB/상태/로그 쓰기를 하지 않으며 DB_URL 없이도 합성 재현이 가능하다.

## 증상 대응

| 상태 | 대응 |
|---|---|
| token_expired | 해당 제공자 앱이 갱신하면 다음 주기에 자동 해제. 수집기에서 직접 refresh 없음 |
| auth_required/auth_rejected | 제공자 앱으로 갱신, expiresAt 변경 자동 해제 관측. 게이트 삭제/반복 --once 금지 |
| no_credentials | 파일 존재만 값 없이 확인 후 제공자 앱 로그인/갱신 대기 |
| rate_limited | Retry-After/백오프 대기. 추가 실제 호출 금지 |
| upstream_error/network_error | 로그의 안전한 진단 확인, 다음 주기 재시도 |
| DB 저장 실패 (dbOk=false) | DB_URL 존재 여부·Neon 컴퓨트 한도·네트워크 연결 및 마이그레이션 확인. 오류 원문을 출력하지 않음 |
| Argon 쿼터 누락 | `ZZIK_AGY_CLI_PATH` 경로 및 실행 권한 확인. PM2 환경 PATH에 agy가 있는지 확인 |
| runAt 45분 이상 정지 | PM2 상태와 900초×3 stale 기준 확인, 승인된 재시작 절차 적용 |

## 금지

운영 재시작·DB migration·Worker secret 주입·배포는 해당 지시가 있을 때만 실행한다. 실제 자격 증명·DB_URL·refresh token·이메일·계정 ID 출력 금지. 상태/게이트 삭제, 개발 `--once` 실쓰기, 승인 없는 DB seed/삭제 금지.
