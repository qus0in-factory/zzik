---
name: zzik-usage-collector
description: zzik 사용량 수집기를 설치·재시작하거나 상태 확인·장애 대응할 때 사용. PM2 등록·재시작·로그 확인, dry-run, token_expired·rate_limited·no_credentials·KV 쓰기 실패·수집 중단 대응 문구에서 트리거.
---

# zzik usage collector 운영

기준: `docs/adr/0.2-claude-usage.md` D2(실행 순서·로컬 파일)·D3(토큰)·D5(백오프·게이트).

## 전제 (SSH 전용 무인 운영)
- 이 Mac은 원격 SSH 전용이라 GUI 승인(Keychain '항상 허용', launchd 백그라운드 항목)이 불가능하다. Keychain을 쓰지 않는다.
- Claude 자격 증명: `~/.claude/.credentials.json` 파일만 읽는다(Claude Code가 갱신한다. 수집기는 절대 refresh token을 읽지 않는다).
- KV 쓰기: 이 Mac에 로그인된 wrangler를 수집기가 실행한다(토큰 파일 없음). namespace id는 `collector/ecosystem.config.cjs`의 env에 있다.
- 데몬: PM2 상주 프로세스가 300초마다 실행한다(실행이 밀리면 그 주기는 스킵).

## 설치·재시작
- `pnpm install && pm2 start collector/ecosystem.config.cjs && pm2 save` (리포 루트에서. wrangler 어댑터가 repo node_modules를 쓴다).
- 재시작 `pm2 restart zzik-usage-collector`, 중지 `pm2 stop zzik-usage-collector`, 제거 `pm2 delete zzik-usage-collector && pm2 save`.
- 게이트·봉투는 상태 파일에 남으므로 재시작해도 카운터가 초기화되지 않는다(정상).

## 상태 확인
- 로그(실행당 한 줄): `~/Library/Logs/zzik/usage-collector.log` — 시각, status, called, httpStatus, tokenExpiresAt, kv 결과, status 전이, token_refreshed. `pm2 logs zzik-usage-collector --lines 20 --nostream`도 같은 내용.
- 상태 파일: `~/Library/Application Support/zzik/usage-state.json` — 마지막 봉투(previous)와 게이트(nextAllowedAt·failCount).
- KV 실측: `pnpm exec wrangler kv key get usage:claude --namespace-id <id> --remote`
- status 의미: ok(정상) / rate_limited(429) / token_expired / auth_required(401·403) / no_credentials / upstream_error(5xx·timeout) / network_error.

## dry-run (쓰기 없음 — 상태·KV·로그 미변경)
- 안전 케이스(네트워크 호출 없음): `node collector/main.mjs --dry-run --credentials-file tests/fixtures/credentials.expired.json` → `status=token_expired`.
- `node collector/main.mjs --dry-run --credentials-file /nonexistent` → `status=no_credentials`, 종료 코드 0.
- 인자 없는 dry-run은 실제 자격 증명으로 upstream을 호출한다(아래 금지 참조). `--credentials-file`은 `--dry-run`과만 함께 쓸 수 있다(위반 시 종료 코드 64).

## 증상별 대응
| 증상(로그 status) | 대응 |
|---|---|
| token_expired | 이 Mac에서 Claude Code를 한 번 실행하면 토큰이 갱신되고 다음 주기에 자동 해제. 수집기 조치 없음 |
| rate_limited | 아무것도 하지 말고 대기. Retry-After와 지수 백오프가 자동으로 게이트를 걸며 재시도해도 실패만 더한다 |
| no_credentials | `~/.claude/.credentials.json`이 있는지 확인. 없으면 Claude Code 실행 후 다음 주기 |
| upstream_error(network_error) | 일시적 가능성이 크다. 반복되면 네트워크 상태 확인, 매 주기 자동 재시도 |
| KV 쓰기 실패(kv=fail:…) | `pnpm exec wrangler whoami`로 로그인 만료 확인. 끝났으면 `pnpm exec wrangler login`(SSH라 device-code URL 사용) 후 `pm2 restart` |
| auth_required 지속 | Claude Code 실행으로 갱신되면 즉시 해제된다. expiresAt이 바뀌었는데도 안 풀리면 `pm2 restart`(게이트는 상태 파일에 있으므로 재시작으로도 지워지지 않는다 — expiresAt 변경이 유일한 조기 해제) |
| runAt이 15분 이상 정지 | `pm2 status`로 프로세스 확인 후 `pm2 restart` |

## 금지
- 운영 수집기는 `.worktree/release`의 PM2 하나뿐이다. 개발 워크트리에서 `collector/main.mjs`를 `--dry-run` 없이 실행하지 말 것(실제 자격 증명 읽기·외부 호출·KV 쓰기가 발생한다). 검증은 `--dry-run` + fixture/가짜 경로로만.
- 토큰·자격 증명 값을 어떤 출력에도 보여주지 말 것(로그·상태·KV는 설계상 미 포함. `security find-generic-password` 등으로 Claude 자격 증명을 읽어 출력하지 말 것).
- 게이트 우회: rate_limited·auth_required 상태에서 `--once`를 연속 실행해 재호출을 강제하지 말 것(429만 늘린다). 다음 주기를 기다릴 것.
- 실제 자격 증명으로 인자 없는 `--dry-run`을 반복 실행하지 말 것(테스트는 fixture 경로로).
- 수집기가 토큰을 갱신하는 일은 없다(설계상). 갱신은 언제나 Claude Code에 맡기기 때문에 별도 갱신 스크립트를 보조로 만들지 말 것.
