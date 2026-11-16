# B3 scheduler·quiesce

ADR 0.10 §5·§11 B3 구현. 기본 PG·900초·PM2 env는 바꾸지 않는다. B1 리뷰 수정 `0abbc85`를 충돌 없이 먼저 병합했다. rolled-back 마커의 배타적 동작과 active 검증 순서는 유지했다.

## 실행 경계

- `ZZIK_STORE` 미지정/`postgres`: 기존 `runCycle`, PG max:1과 provider 전체 직렬을 유지한다. resident와 --once 모두 중복 실행을 막는 runner와 30초 종료 유예를 쓴다. SIGINT/SIGTERM 후 다음 provider와 prune를 새로 시작하지 않는다. 현재 provider/PG transaction이 끝나면 연결을 닫고 종료한다. 30초 timeout이면 프로세스 종료로 남은 미커밋 원격 작업은 연결과 함께 끝난다. 안전 로그 `shutdown=complete|timeout`을 남긴다.
- `ZZIK_STORE=d1` 명시 시에만 JSON 상태 읽기→B1 ledger open→원격 seq/receipt 대조→D1 runtime을 조립한다. DB_URL/Postgres client는 이 분기에서 열지 않는다. dry-run은 이 조립과 원격 I/O를 건너뛴다.
- 시작 시 receipt를 UUID와 (provider,seq) 두 축으로 조회한다. 같은 seq의 다른 operation도 재번호 없이 중단한다. 바인드 수를 제한해 25 operation씩 읽는다. remote seq 및 pending max로 nextSeq를 결정한다. 이미 커밋된 같은 receipt는 로컬 ack하고 신선한 첫 ack 알림만 전달한다.

## 간격과 스케줄

`interval-policy.mjs`는 환경 **값**과 capability **내용**만 받는 순수 함수다. 파일은 infra가 읽는다. capability는 `{v:1,readStore:'d1',bucketRoute:true}`여야 하며 없음/파손/불일치는 fail closed다. PG 또는 capability 없는 D1은 900 미만 거부. 유효 capability D1은 개별 `ZZIK_INTERVAL_SEC_<PROVIDER>`를 180 이상 허용한다. legacy 공통 간격은 900 미만 거부하며, provider override가 없는 값은 그 공통 기본 900을 쓴다. 설정 실패는 main에서 78이다.

D1 전체 2, provider당 1, Antigravity 1. provider in-flight를 먼저 예약한 뒤 callback을 호출해 동기 re-entry도 막는다. 실제 upstream 직전 markStarted가 lastStartedAt을 로컬 커밋한다. credential/gate 확인만 하고 건너뛴 tick은 lastStartedAt을 움직이지 않는다. nextDue는 별도 로컬 tick 시각이며 upstream 간격 하한과 함께 확인한다. gate·기존 429/5xx/auth backoff 계산은 runOnce를 재사용한다.

슬립 후 현재 eligible provider를 한 번씩 후보로 삼는다. 과거 tick을 재생하지 않는다. runAt이 직전 수용보다 1ms라도 이르면 seq/operation/alert 기준을 발급하지 않는다. nextDue는 max(now,previous.runAt)+interval. 연속 3회면 그 provider만 영속 clockStopped로 멈추고 안전 notice를 보낸다. 다른 provider는 계속한다.

## D1 관측 수용

runD1Provider는 기존 runOnce의 파싱·가림·gate·alert diff 계산을 staging 포트로 실행한다. store/state/logger는 메모리 버퍼이며 PG·legacy JSON·원격 ack를 실행하지 않는다. 계산 완료 뒤 acceptObservation으로 봉투·seq·emit/hash·gate·alert 목록/baseline을 한 ledger 트랜잭션에 수용한다. 로그는 kvOk=false/queued다. 실제 kvOk와 알림 전달은 B2 sender ack에만 있다.

새 upstream 전 sender.canCollect, queue 상한, provider 영속 due/start를 확인한다. 종료가 upstream **시작 전**이면 호출하지 않는다. 이미 시작한 upstream이 종료 유예 중 끝나면 그 관측의 수용 커밋까지 마친다.

## 종료 유예

quiescer가 새 provider·sender tick·poll timer를 먼저 막는다. 현재 provider 작업, 현재 sender/maintenance 작업만 최대 30초 기다린다. outbox 전체 catch-up을 drain하지 않는다. 원격 query lane은 송신 직전 canRequest를 다시 확인해 rate-limit 대기 중인 다음 HTTP도 새로 시작하지 않는다. 미ack operation은 다음 기동에서 같은 id/hash로 재생한다.

취소된 health read는 장애 notice를 보내지 않으며 조회 체크포인트를 되돌려 다음 기동에서 다시 조회하게 한다. 현재 HTTP가 끝난 뒤 이어지는 maintenance DELETE도 중단한다. 로컬 transaction은 동기적으로 완료하며 네트워크를 기다리면서 열어 두지 않는다.

## prune 체크포인트

LedgerPort.checkpointPrune을 추가했다. unknown 첫 주기는 lastPruneAt=null을 유지한 채 skippedAtMs를 별도로 기록하고 24시간 기다린다. 실제 prune 성공 시 B2가 돌려준 lastPruneAt 값을 그대로 커밋한다. 실패하면 기존 값을 유지한다. 재기동해도 skip/checkpoint가 보존된다. B2 후속 요청 1을 해소했다.

## 검증과 운영

가짜 provider/REST/Discord와 로컬 SQLite/PGlite만 쓴다. 실제 PG 연결 하나의 BEGIN→ROLLBACK→BEGIN→COMMIT 순서 및 유예 중 provider·HTTP 동시 대기를 검증한다. 운영 자격·D1·Discord 호출, PM2 변경, 재시작, 배포는 하지 않는다. 두 핵심 경로 리뷰 관문 및 D 단계 운영 전환은 별도다.
