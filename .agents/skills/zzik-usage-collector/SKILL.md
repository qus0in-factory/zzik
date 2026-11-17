---
name: zzik-usage-collector
description: D1 단독 수집기의 PM2 설치·재시작·간격·OAuth·outbox 장애 대응 시 사용.
---
# D1 수집기 운영

ADR 0.10과 docs/d1-d-cutover.md. 운영 인스턴스는 release의 zzik-usage-collector 하나, Node 24.22+다. 기본 env가 D1/OAuth 전용 zzik-collector profile, codex/antigravity/opencode/grok/ollama 180초·Claude 900초다. capability `{ "v":1,"readStore":"d1","bucketRoute":true }`를 state-dir에 유지한다. 명시 postgres는 78이며 PG writer/백필이 없다. DB_URL/.env/Neon은 미사용으로 그대로 두고 삭제하지 않는다.

## 승인된 반영

Worker 선배포·검증 후 release frozen install. 주기 사이에 `pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env`, `pm2 save`. named env 선택은 제거됐다. kill_timeout 35000·30초 quiesce, release cwd/env-file·runtime/saved 간격 일치를 비밀값 없이 확인한다. D1 식별자/토큰/DB_URL을 PM2 환경으로 복사하지 않는다.

자격은 기존 Node --env-file의 D1 식별자와 전용 Wrangler profile 0600을 사용한다. collector OAuth refresh만 승인된 공급자가 수행하며 provider 토큰 로그인/refresh는 하지 않는다. Antigravity는 기존 agy /quota 경로를 유지하고 수동 실제 --once를 반복하지 않는다. dry-run은 합성 파일/없는 경로만 사용하고 원격/상태 쓰기가 없음을 확인한다.

## 점검·장애

- ledger/outbox/control/marker·gate를 삭제/초기화하지 않는다. receipt/snapshot write_seq와 local ack, 다음 시각·실제 시작 간격·outbox 나이를 확인한다. 재시작은 기존 nextDue를 보존한다.
- provider 429/gate면 해당 override만 900으로 실제 PM2에 반영한다. D1 non2xx/오래된 outbox/인증 정지는 수집 정지 또는 전체 900 복귀 후 보고한다. PM2 env 병합 때문에 설정 파일 키 삭제만으로 반영을 단정하지 않는다.
- 알림은 기존 ZZIK_ALERT_WEBHOOK_URL/ZZIK_ALERTS와 ledger baseline을 쓴다. Discord 없음만으로 정상을 판단하지 말고 안전한 `[zzik collector] reason=`/alerts=sent|failed를 확인한다. 비밀/원문/Location 전문을 출력하지 않는다.
- 격리 해제는 collector 정지/quiesce 완료, 원격 in-flight 완료·receipt 부재 확정 후에만 한다. gate/순번을 재번호하지 않는다.
- export 36시간 경보·R2 보존 30일 이상·이벤트 30일/receipt 35일 정리를 관측한다. 실제 export 성공과 로컬 테스트를 구분한다.
- D1 불통 시 PG로 모드만 바꾸지 않는다. 수집 정지 후 forward-fix/R2→scratch D1 복구·id 펜스·outbox 재생을 검증한다. 운영 D1 덮어쓰기/Neon 삭제/secret 삭제는 이번 권한에 없다.

상태 확인은 `scripts/d1-status.mjs`, 수집기 반영은 `scripts/collector-apply.mjs`(기본 dry-run, 명시 `--apply`, 필요 시 `--release <경로>`)를 사용하며 두 도구는 최종 JSON 한 줄만 출력한다.
