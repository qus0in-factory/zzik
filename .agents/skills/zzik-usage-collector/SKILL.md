---
name: zzik-usage-collector
description: D1 단독 수집기의 PM2 설치·재시작·간격·OAuth·outbox 장애 대응 시 사용.
---
# D1 수집기 운영

ADR0.10과 docs/d1-d-cutover.md. 운영인스턴스는release의zzik-usage-collector하나, Node24.22+다. 기본env가D1/OAuth전용zzik-collector profile, codex/antigravity/opencode/grok/ollama180초·Claude900초다. capability `{ "v":1,"readStore":"d1","bucketRoute":true }`를state-dir에유지한다. 명시postgres는78이며PGwriter/백필이없다. DB_URL/.env/Neon은미사용으로그대로두고삭제하지않는다.

## 승인된 반영

Worker선배포·검증후 release frozen install. 주기사이에 `pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env`, `pm2 save`. namedenv선택은제거됐다. kill_timeout35000·30초quiesce, releasecwd/env-file·runtime/saved간격일치를비밀값없이확인한다. D1식별자/토큰/DB_URL을PM2환경으로복사하지않는다.

자격은기존Node --env-file의D1식별자와전용Wranglerprofile0600을사용한다. collectorOAuthrefresh만승인된공급자가수행하며provider토큰로그인/refresh는하지않는다. Antigravity는기존agy /quota경로를유지하고수동실제--once를반복하지않는다. dry-run은합성파일/없는경로만사용하고원격/상태쓰기가없음을확인한다.

## 점검·장애

- ledger/outbox/control/marker·gate를삭제/초기화하지않는다. receipt/snapshotwrite_seq와localack, 다음시각·실제시작간격·outbox나이를확인한다. 재시작은기존nextDue를보존한다.
- provider429/gate면해당override만900으로실제PM2에반영한다. D1non2xx/오래된outbox/인증정지는수집정지또는전체900복귀후보고한다. PM2env병합때문에설정파일키삭제만으로반영을단정하지않는다.
- 알림은기존ZZIK_ALERT_WEBHOOK_URL/ZZIK_ALERTS와ledgerbaseline을쓴다. Discord없음만으로정상을판단하지말고안전한 `[zzik collector] reason=`/alerts=sent|failed를확인한다. 비밀/원문/Location전문을출력하지않는다.
- 격리해제는collector정지/quiesce완료, 원격in-flight완료·receipt부재확정후에만한다. gate/순번을재번호하지않는다.
- export36시간경보·R2보존30일이상·이벤트30일/receipt35일정리를관측한다. 실제export성공과로컬테스트를구분한다.
- D1불통시PG로모드만바꾸지않는다. 수집정지후forward-fix/R2→scratchD1복구·id펜스·outbox재생을검증한다. 운영D1덮어쓰기/Neon삭제/secret삭제는이번권한에없다.
