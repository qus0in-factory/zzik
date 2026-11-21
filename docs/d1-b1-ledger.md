# B1 ledger 모듈 계약

ADR 0.10 §5·§11 B1 구현. 운영 배선은 없다. `collector/main.mjs`, `runCycle`, 기존 PG·JSON 경로는 이 모듈을 import하지 않는다. A단계 파일은 수정하지 않았다.

- `collector/domain/usage/d1-ledger.mjs`: 순수 수용·ack·seq 대조·체인 단절 전이. 기존 snapshotChanged/eventHeartbeatDue와 A 쓰기 계약·payload hash를 재사용한다.
- `collector/domain/usage/d1-ledger-types.ts`: LedgerPort, 동기 전이, B2용 LedgerSenderPort 타입. 전이 콜백에서 비동기 원격 요청을 할 수 없다.
- `collector/infra/usage/sqlite-ledger.mjs`: node:sqlite 영속화. state+outbox를 한 트랜잭션으로 저장한다. WAL·FULL, 부모 0700, DB·WAL·SHM·마커·잠금 파일 0600. 기동 중 umask 077을 적용하고 반환 시 원래 값으로 복원한다.

## 향후 app 조립 시 호출 순서

1. D1 모드에서만 openSqliteLedger. JSON reader가 읽은 provider별 legacy 상태와 usage-prune.json.lastPruneAt을 전달한다. JSON 파일을 이 모듈이 변경하지 않는다. rolled-back 마커면 JSON 없이는 중단하며 옛 DB를 열지 않고 파일을 보관한 뒤 다시 import한다.
2. 원격 snapshot seq와 확정 receipt 사실을 모아 update(provider, data => reconcileSequence(...))를 호출한다. 원격 조회 실패를 null receipt로 바꾸지 않는다. nextSeq는 **다음 발급값**이므로 reconcile의 로컬 고수위는 nextSeq-1이다.
3. provider API 호출 전 stats/queueHealth와 영속 gate를 확인한다. acceptObservation에는 이미 가린 봉투, 고정 operation UUID, 이미 정한 lastStartedAt/nextDue, 한 번 계산한 알림 목록·baseline을 전달한다. 수용은 remote 성공이 아니다.
4. pending은 provider별 FIFO head만 반환한다. B2 sender가 전역 round-robin·재시도·알림 전송을 담당한다. 성공 receipt로 acknowledgeOperation 전이를 커밋한 뒤에만 kvOk를 보고한다. B1은 sender를 생성·호출하지 않는다.
5. quarantine(nowMs)은 엄격히 7일 초과 건을 표시한다. pending도 오래된 head를 자동 전송하지 않는다. 큐 count/bytes/age 제한은 새 수용만 차단하며 ack·정리는 허용한다.
6. 400 폐기/격리 미전송 재개는 breakChain 순수 전이를 update 안에서 실행한다. FIFO head만 폐기하며, sender를 정지하고 in-flight 요청이 없음을 확인한 상태에서 폐기 대상과 바로 뒤 operation의 authoritative receipt 부재를 요구한다. 뒤 operation이 원격 커밋됐거나 receipt 조회가 불명확하면 중단한다. UUID·seq·봉투는 유지하고 emitEvent/payloadSha256만 재고정한다. 기준은 remoteCommitted/remoteCommittedLastEventAt이다. 남은 수용 체인이 있으면 refix 후 그 체인의 마지막 표본으로 captured 상태를 재구성한다.

## 상태와 복구

- 외부 collector-ledger.marker.json은 active/rolled-back을 구분한다. 롤백 시 마커를 삭제하지 않고 반드시 `rolled-back` 마커만 남긴다. 따라서 `마커 없음 + SQLite 있음`은 SQLite 커밋 직후 외부 마커 rename 전에 종료된 크래시로만 해석해 재import 없이 복구하고, `rolled-back` 마커 + SQLite 있음(+JSON)은 롤백 후 재전환으로 보고 기존 SQLite(`-wal`, `-shm` 포함)를 타임스탬프 이름으로 archive(삭제 금지)한 뒤 JSON을 재import한다. 내부 initialized 마커와 제공자별 행으로 빈 DB를 검증하며, `active` 마커는 import 및 `parseD1Envelope` 검증 완료 뒤에만 쓴다.
- 단독 잠금은 별도 SQLite DB의 프로세스 수명 EXCLUSIVE 트랜잭션이다. 프로세스 종료 시 OS가 해제하며, stale PID 파일을 삭제할 필요가 없다. 다른 기동은 78 결과를 받는다.
- SQLite commit 실패는 그 인스턴스의 수용을 latch로 차단한다. 큐/상태는 rollback하고 프로세스를 종료하지 않는다. 읽기·점검·종료는 가능하다. 안전한 복구 뒤 재기동은 운영자의 별도 절차다.
- lastPruneAt 누락/깨짐은 skipFirstPrune=true로 보고한다. 실제 prune 스케줄(보고 후 다음 24시간)은 향후 app 조립에서 기존 규칙으로 실행한다.
- rollback 변환 도구에는 `{provider, ...data.state, ...pruneState}`와 PG 역이관 커밋 기준을 별도로 전달할 수 있다. B1이 PG 역이관, JSON 쓰기, rolled-back 마커 전환을 실행하지 않는다.

## 범위 밖

B2 HTTP sender·재시도·알림 전송, B3 scheduler·clock_skew 연속 3회 중단·signal 유예, C 백필 outbox 0 확인, D 운영 전환은 이 patch에 없다. 운영 DB/플래그/수집기 변경도 없다. 두 핵심 경로 리뷰 관문은 별도로 필요하다.
