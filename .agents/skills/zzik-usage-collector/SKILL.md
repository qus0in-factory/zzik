---
name: zzik-usage-collector
description: 수집기의 PM2 설치·재시작·간격·OAuth·outbox 장애 대응 시 사용.
---
# 수집기 운영

운영 인스턴스·런타임 버전·기본 env·저장소 상태·provider 목록 및 수집 주기·capability 기준·미사용 보존 대상은 `docs/harness/operations.md` 참고.

## 승인된 반영

Worker 선배포·검증 후 release frozen install. 주기 사이에 `pm2 restart collector/ecosystem.config.cjs --only <인스턴스> --update-env`, `pm2 save`(인스턴스명과 `kill_timeout`·quiesce 수치는 `docs/harness/operations.md` 참고). named env 선택은 제거됐다. release cwd/env-file·runtime/saved 간격 일치를 비밀값 없이 확인한다. 저장소 식별자/토큰/DB_URL을 PM2 환경으로 복사하지 않는다.

자격은 기존 Node --env-file의 저장소 식별자와 전용 Wrangler profile 0600을 사용한다. collector OAuth refresh만 승인된 공급자가 수행하며 provider 토큰 로그인/refresh는 하지 않는다. Antigravity는 기존 agy /quota 경로를 유지하고 수동 실제 --once를 반복하지 않는다. dry-run은 합성 파일/없는 경로만 사용하고 원격/상태 쓰기가 없음을 확인한다.

## 점검·장애

- ledger/outbox/control/marker·gate를 삭제/초기화하지 않는다. receipt/snapshot write_seq와 local ack, 다음 시각·실제 시작 간격·outbox 나이를 확인한다. 재시작은 기존 nextDue를 보존한다.
- provider 429/gate면 해당 override만 상한 주기(`docs/harness/operations.md` 참고)로 실제 PM2에 반영한다. 저장소 non2xx/오래된 outbox/인증 정지는 수집 정지 또는 전체 상한 주기 복귀 후 보고한다. PM2 env 병합 때문에 설정 파일 키 삭제만으로 반영을 단정하지 않는다.
- 알림은 기존 ZZIK_ALERT_WEBHOOK_URL/ZZIK_ALERTS와 ledger baseline을 쓴다. Discord 없음만으로 정상을 판단하지 말고 안전한 `[zzik collector] reason=`/alerts=sent|failed를 확인한다. 비밀/원문/Location 전문을 출력하지 않는다.
- 격리 해제는 collector 정지/quiesce 완료, 원격 in-flight 완료·receipt 부재 확정 후에만 한다. gate/순번을 재번호하지 않는다.
- export 경보·백업 보존·이벤트/receipt 정리 주기(`docs/harness/operations.md` 참고)를 관측한다. 실제 export 성공과 로컬 테스트를 구분한다.
- 저장소 불통 시 임의로 모드를 전환하지 않는다. 수집 정지 후 `docs/harness/operations.md`의 복구 절차(forward-fix·백업 복구·id 펜스·outbox 재생)를 검증한다. 운영 저장소 덮어쓰기/원격 리소스/secret 삭제는 이번 권한에 없다.

## 새 제공자 추가

- 실측 자격 형식(OAuth `access`, API 키 `{type:"key", key}` 등)을 합성 테스트 입력으로 고정한다. 기존 리더 재사용 시 그 형식을 읽는지 확인한다.
- 원장은 기존 행을 두고 누락 제공자 행만 추가한다. 재시작 전 `scripts/ledger-preflight.mjs`(collector-apply가 자동 실행)로 운영 원장 복사본이 새 코드로 열리는지 본다.
- Worker 배포 검증은 수집기 반영 전이라 새 제공자 스냅샷이 없으면 `SKIP(no_snapshot)`이 정상이다. 반영 후 `scripts/usage-live-shape.sh <id>`로 `status=ok`를 확인한다.
- 사례: `docs/postmortem/0.6.62-zai-usage.md`.

상태 확인은 `scripts/d1-status.mjs`, 수집기 반영은 `scripts/collector-apply.mjs`(기본 dry-run, 명시 `--apply`, 필요 시 `--release <경로>`)를 사용하며 두 도구는 최종 JSON 한 줄만 출력한다.
