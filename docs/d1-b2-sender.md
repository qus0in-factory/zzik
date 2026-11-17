> G1 현재 상태: D1 단독 런타임이다. 아래 단계별 구현 기록 중 PG/꺼진 경로/PG 복귀 설명은 당시 이력이며 현재 운영 명령은 docs/d1-d-cutover.md를 따른다. 기본 PM2 env가 D1이며 PostgreSQL 드라이버/백필 도구는 제거됐다.

# B2 sender 계약

ADR 0.10 §3·§5·§11 B2의 꺼진 모듈이다. main/runCycle/env/PM2/PG 경로는 변경하지 않는다. A·B1 파일은 수정하지 않았다.

## 조립 조건

- D1 모드일 때 B1 ledger의 프로세스 수명 잠금을 먼저 얻는다. 같은 state directory 아래 `createD1ControlFile`을 하나 만든다. 관측 sender·maintenance가 **같은 createD1RestClient 인스턴스**를 주입받아야 한다. 하나의 query lane에서 모든 HTTP를 직렬화하고 요청 시작을 최소 1초 간격으로 제한한다. 별도의 REST 클라이언트를 만드는 조립은 이 계약 위반이다.
- query client는 mode/dryRun을 직접 검사한다. postgres/dry-run이면 원격 I/O 0이다. fetch·clock·wait를 주입하며 자격은 환경에서 직접 읽지 않는다. 실제 fetch를 주입하는 런타임 배선은 없다.
- sender tick을 B3가 호출한다. 같은 sender의 중복 tick은 busy로 끝난다. provider 안 FIFO, provider 간 round-robin으로 B1 pending head를 선택한다. provider API를 다시 호출하거나 operation/seq/봉투/hash를 새로 만들지 않는다.
- 새 provider 호출 전 `sender.canCollect(provider)`와 B1 gate/queue 상태를 함께 확인해야 한다. auth/local failure는 전체를, 400은 해당 provider를 차단한다. PG/dry-run에서는 이 D1 수집 차단을 적용하지 않는다.

## 원격·로컬 ack

A의 buildD1WriteBatch를 그대로 POST한다. receipt→snapshot→조건부 event 순서다. HTTP 2xx, 최상위 success, statement 수 일치, 각 success=true가 모두 충족돼야 원격 성공이다. 응답/JSON/statement 실패는 커밋 불명으로 같은 operation을 재전송한다. 요청과 body decode 전체에 15초 deadline을 적용하고 AbortController로 취소한다.

성공 뒤 B1 acknowledgeOperation을 로컬 트랜잭션으로 커밋한다. 실패하면 local failure를 latch하고 큐를 보존한다. 원격·로컬 ack를 모두 확인한 결과만 kvOk=true다. 첫 로컬 ack 직후에 고정 알림 목록을 한 번 전달하며, 관측 runAt 기준 나이가 interval을 넘으면 알림은 생략한다. 알림 diff를 재계산하지 않는다. 로컬 ack와 webhook의 exactly-once는 보장하지 않는다.

## 실패와 제어 파일

- 401/403: 전체 중단을 제어 파일에 저장한다. 저장한 credentialKey는 토큰의 SHA-256이며 토큰 원문은 저장하지 않는다. 같은 자격으로 재기동해도 중단을 유지하고, 다른 토큰으로 생성한 client만 auth 중단을 해제한다. credential 회전은 예전 client가 종료된 뒤 새 프로세스에서 한다.
- 400: provider와 operation id를 영속 중단 목록에 넣는다. 다른 provider는 계속 처리한다. 운영자가 sender/in-flight를 정지하고 receipt 부재를 확정한 뒤에만 discard400을 호출한다. 이 연산은 HTTP 없이 B1 breakChain으로 기준을 복구·후속 operation을 refix한다. ledger 폐기 커밋 뒤 제어 파일 정리에 실패했다면 재호출해 이미 사라진 operation의 중단 표시만 정리할 수 있다.
- 429: query lane 전체가 Retry-After 이상 기다린다. sender도 전역 대기하며 provider gate/failCount는 변경하지 않는다.
- timeout/5xx/불명 응답: 5초 base, 300초 cap의 full jitter와 더 긴 Retry-After 중 큰 값을 사용한다. attempts/nextAttemptAt은 B1 outbox에 저장한다. D1 Retry-After는 기존 provider parser의 5분 최솟값과 다르므로 별도 순수 정책이다.
- 제어 파일은 원자 rename+file/directory fsync, 0600(부모 0700)이다. 인증 중단·provider 중단·다음 HTTP 시작·export 조회 체크포인트만 기록한다. 깨짐/읽기·쓰기 실패는 fail closed다. 데이터 쓰기는 B1 프로세스 잠금 아래에서만 허용한다.

## maintenance

checkHealth는 D1 모드에서만 24시간에 한 번 마지막 성공 export와 stalled checkpoint를 같은 REST batch로 읽는다. 조회 시각은 기록 직전 control 재읽기 후 `lastHealthCheckAtMs`만 갱신해 제어 파일에 영속화한다. 36시간 초과·성공 export 없음·stall·읽기 실패는 안전한 reason만 notice port로 보내며, 같은 사유 알림은 24시간에 1회로 제한한다. 원문 응답/토큰은 알림에 넣지 않는다.

prune는 관측 batch와 섞지 않는다. provider별 이벤트(`usage_event`)·버킷 경계(`usage_bucket_boundary`)·receipt(`usage_write_receipt`)를 각각 별도 HTTP로 500행씩 지운다. 이벤트는 `run_at`, 경계는 `run_at_ms` 기준으로 `retentionDays`만큼 지우고, receipt는 `created_at_ms` 기준 35일이다. 경계는 `rowid` 배치 키로 지우며 체크포인트(`usage_bucket_checkpoint`)는 지우거나 되돌리지 않는다. 어느 단계든 실패하면 이전 lastPruneAt을 반환한다. 모두 끝난 경우만 새 값을 반환한다. 무한 삭제를 막기 위해 표·provider당 한 번의 호출은 최대 100 batch로 제한하며, 다 못 끝내면 incomplete로 반환한다.

## B1 인터페이스 요청 / 범위 밖

B1 LedgerPort는 pruneState 읽기만 제공한다. 실제 runtime 조립 전 **성공한 prune의 lastPruneAt 저장과 unknown 첫 주기 skip checkpoint 저장 포트**가 필요하다. B2는 새 lastPruneAt을 결과로 반환하며 B1 파일을 수정하지 않는다.

B1 LedgerSenderPort의 단순 send/receipt 결과만으로는 HTTP 분류·maintenance를 표현할 수 없어 B2 전용 D1QueryPort/D1ControlPort를 추가했다. B1 타입은 변경하지 않았다. runtime 조립에서 포트를 명시적으로 선택해야 한다.

B3 scheduler·signal quiesce·provider gate 조립, 실제 토큰 교체/Discord/원격 D1 검증, export cron/R2 생성은 이 patch가 하지 않는다. 핵심 경로 두 리뷰 관문과 운영 승인은 별도다.

maintenance 알림 제한은 ledger meta의 maintenance_notices에 reason별 시각을 기록한다. 외부 알림 전에 SQLite transaction으로 24시간 슬롯을 claim하므로 runtime 재생성·재기동과 control 파일 오류에도 제한이 유지된다. 첫 unknown prune 알림도 같은 저장소를 공유한다. claim을 영속화할 수 없으면 추적되지 않은 외부 알림을 보내지 않는다. 이 메타는 기존 ledger_meta에 저장하며 새 schema migration은 없다.
