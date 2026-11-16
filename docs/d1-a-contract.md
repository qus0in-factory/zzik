# D1 A단계 계약 도구

정본은 [ADR 0.10](adr/0.10-d1-storage.md) §3·§4·§11이다. 이 문서는 z-sol 소유 순수 함수의 호출 규칙이다. **현재 런타임은 이 모듈을 import하지 않는다.** 운영은 PG·900초이며 전송·상태 파일 쓰기·마이그레이션은 없다.

## 공용 타입과 API

`shared/d1-contract.ts`는 `CollectorD1WriteV1`, `D1SqlStatement`, `D1WriteReceipt`, `D1MigrationRow`, `D1OperationFacts`, `D1OperationClassification`, `PgRollbackEventRow`, `PgRollbackSnapshotRow`, `D1Result`를 제공한다. 타입 import는 Node의 type stripping과 호환된다.

| 위치 | 함수 | 결과 |
|---|---|---|
| collector/domain/usage/d1-write-contract.mjs | createCollectorD1Write(input) | v1 operation 검증·payloadSha256 계산 |
| 같은 파일 | validateCollectorD1Write(operation) | 봉투·UUID·seq·기존 hash 검증 |
| 같은 파일 | buildD1WriteBatch(operation) | 순서가 고정된 `{sql, params}[]`. HTTP body/전송 아님 |
| shared/d1-canonical.ts | normalizeD1Instant(value) | UTC ms와 ISO 문자열 |
| 같은 파일 | canonicalEnvelope(json) | 객체의 키를 재귀 정렬한 JSON 문자열 |
| 같은 파일 | migrationRowTuple(row) | ADR §4.4의 정확한 hash 입력 |
| 같은 파일 | checkMigrationTimeOrder(rows) | PG 정밀도 정렬과 ms/id 정렬의 provider별 동등성 |
| collector/domain/usage/d1-migration.mjs | migrationRowSha256(row), compareMigrationRows(expected, actual) | 전체 봉투 hash와 같은 id의 내용 충돌 검사 |
| 같은 파일 | normalizeMigrationRow(row), toPgRollbackEvent(row), toPgRollbackSnapshot(row, updatedAtMs) | z-ds의 runAtMs/envelope 역이관 형식 변환 |
| 같은 파일 | classifyPgRollbackRow(expected, actual) | missing/matching/snapshot_replace. event 충돌은 실패 |
| collector/domain/usage/d1-reconciliation.mjs | classifyD1Operation(facts) | receipt/outbox/명시적 PG 대상의 분류·후속 작업 제안 |
| collector/domain/usage/d1-legacy-state.mjs | ledgerToLegacyState(ledger, pgCommitted) | 기존 provider JSON과 usage-prune.json 내용 |

위 계약·변환 함수는 `{ok:true,value}` 또는 `{ok:false,reason}`를 반환한다. reason에는 입력 원문·SQL·연결 정보가 없다. SHA-256은 기존 collector/domain/usage/envelope.mjs의 sha256Hex를 재사용한다. 공용 canonical 함수에는 crypto·파일·타이머·드라이버 의존이 없다.

## 쓰기 batch

생성자는 UUID를 발급하지 않는다. 나중에 ledger가 **수용할 때 한 번 발급한 UUID v4**와 안전 정수 writeSeq(1..MAX_SAFE_INTEGER), 고정 envelopeJson, emitEvent를 넘긴다. 봉투의 원래 공백/키 순서/문자열을 변경하지 않는다. 전송 시각으로 hash나 operationId를 재생성하지 않는다.

payloadSha256 입력은 `JSON.stringify([1, operationId, provider, writeSeq, envelopeJson, emitEvent])`의 UTF-8 바이트다. 검증에서 다시 계산해 다르면 중단한다.

| statement | 파라미터 순서 |
|---|---|
| receipt INSERT/hash 충돌 가드 | operationId, provider, writeSeq, payloadSha256, runAtMs |
| snapshot UPSERT/seq 가드 | provider, envelopeJson, status, runAtMs, fetchedAtMs 또는null, rawSha256 또는null, collectorVersion, runAtMs, writeSeq, operationId |
| 조건부 event INSERT | provider, runAtMs, status, rawSha256 또는null, envelopeJson, operationId |

created_at_ms와 updated_at은 이 단계의 builder에서 **고정 관측 runAtMs**를 사용하므로 재전송 때 변하지 않는다. receipt 재전송 UPDATE는 created_at_ms를 아예 치환하지 않는다. event가 없으면2문장이다. BEGIN/COMMIT·정리·버킷·export는 포함하지 않는다. B2가 나중에 이 배열을 native `{batch:...}`로 전달해야 한다.

SQL은 `operation_id`, `write_seq` 및 ADR의 기존 snake_case 컬럼을 사용한다. snapshot 비교는 write_seq만이며, event의 operation_id 충돌만 DO NOTHING이다. 광범위 INSERT OR IGNORE는 쓰지 않는다. event id는 DB 자동 채번을 사용하고 last_row_id를 읽지 않는다.

## 이관 hash와 시각

행 입력은 `{id, provider, runAt, status, rawSha256, envelopeJson}`이다. snapshot의 id는null, event는 앞자리0 없는 양의 signed64bit **10진 문자열**이다. Number ID를 받지 않는다. D1 조회 결과는 caller가 CAST(id AS TEXT)로 가져온다.

ADR의 구분자 `|` tuple을 그대로 사용한다:

```
(id ?? provider) + '|' + provider + '|' + runAtMs + '|' + status + '|'
  + (rawSha256 ?? '') + '|' + canonicalEnvelope
```

id가null인 snapshot의 첫 hash 필드는 provider(자연키)이며 z-ds 도구와 같은 표기다. 빈 raw hash는null의 고정 표기다. 나머지 앞쪽 필드는 검증된 provider/status/숫자/hex라 구분자와 충돌하지 않는다. 봉투는 마지막 필드다. canonical은 키를 UTF-16 코드 단위 순으로 재귀 정렬하고 배열 순서·모든 문자열을 보존한다. **rawText 내부 JSON을 다시 해석하거나 정렬하지 않는다.** NaN/Infinity·안전 정수 밖 JSON 숫자는 조용히 바꾸지 않고 거부한다. 실제 원문 속 숫자는 rawText 문자열 안에 있으므로 그대로 보존된다.

컬럼 provider/status/runAt ms가 봉투와 다르면 실패한다. canonical은 봉투 전체를 포함해 fetchedAt/intervalSec/rawRedacted 변경도 검출한다. compareMigrationRows는 같은id·provider인지 확인한 뒤 hash를 비교한다. 같은id의 다른 봉투를 무시하지 않는다. 엄격한 대조 compareMigrationRows와 별개로 classifyPgRollbackRow는 D1이 정본인 최신 snapshot의 차이를 snapshot_replace로 분류한다. snapshot은 원래 PG의 이전 관측을 덮어써야 하므로 event의 같은id 충돌과 구별한다.

시각 입력은 timezone이 명시된 RFC3339이고 소수1~6자리까지 받는다. Worker처럼 밀리초 아래를 **버리고**, UTC로 맞춘다. 날짜 자동 보정과 timezone 없는 시각은 거절한다. 이관 전 checkMigrationTimeOrder에는 PG의 **원래 미세초 텍스트**를 넣어야 한다. JS Date로 먼저 바꾸면 정렬 위험을 이미 잃는다. 이 함수는 전체 정밀도/time,id와 Worker ms,id 정렬을 provider별 비교하고 입력을 변경하지 않는다. 내부 BigInt 비교는 SQL 바인딩에 전달하지 않는다.

### z-ds의 역이관 행 형식

- events: `{id: string, provider, runAtMs, status, rawSha256, envelope: string}`.
- snapshots: `{provider, runAtMs, fetchedAtMs, status, rawSha256, envelope: string, collectorVersion, updatedAtMs}`.

normalizeMigrationRow와 migrationRowSha256은 이 형식도 받는다. toPgRollbackEvent/toPgRollbackSnapshot은 이 필드만 만들어 `operation_id`/`write_seq`를 PG로 복사하지 않는다. snapshot updatedAtMs는 실제 저장 컬럼을 명시적으로 전달한다. fetchedAtMs/collectorVersion이 봉투와 어긋나거나 epoch가 안전 정수·유효 날짜가 아니면 거부한다.

## operation 대조

facts는 새 관측·sender를 멈춘 지점에서 caller가 수집한다. 도구가 DB를 읽거나 commit을 추측하지 않는다.

- receipt null은 **읽기에 성공해 없음이 확인된 것**이다. D1 불통은 receiptUnavailable:true로 전달해 중단한다.
- receipt 있음/outbox 없음은 acknowledged, 둘 다 있음은 response_lost, receipt 없음/outbox 있음은 unsent다. 둘 다 없으면 추적 불가능하므로 실패한다.
- receipt의 operationId/provider/writeSeq/hash가 다르면 중단한다. 새 UUID나 seq를 만들지 않는다.
- PG 비교는 caller가 명시한 expected row와 actual row다. provider/runAt만으로 추측해 연결하지 않는다. expected는 해당 operation의 봉투·raw hash와 맞아야 한다. PG 결과는 not_checked/missing/matching/snapshot_replace이며 event 충돌은 실패다.
- action은 실행이 아니라 제안이다. replay_same_operation은 원래ID로만 전송한다. acknowledge_local은 확인한receipt로 로컬ack를 복구한다. clear_after_pg_commit은 **전체 PG 역이관 transaction과 대조 게이트가 commit된 뒤에만** outbox/마커를 정리하라는 뜻이다. PG 한 행이 일치한다고 전체 역이관 완료를 대신하지 않는다.

## ledger → 구 JSON

ledger 입력은 현재 provider/gate/alerts/lastRun/lastPruneAt다. pgCommitted는 caller가 확인한 `{provider,previous,lastEventAt}`다. 이전 JSON 백업이나 capturedPrevious를 substitute하지 않는다. D1 불통 롤백은 ADR §11 D의 PG 마지막 커밋 기준을 넘긴다.

- previous와 lastEventAt: PG에 커밋된 관측 기준.
- gate/alerts/lastRun: 현재ledger 기준. 인증 대기·알림 baseline·실제 마지막 시도 상태를 지우지 않는다.
- lastPruneAt: 별도 pruneState에도 넣는다. 없거나 깨지면null과 prune_time_unknown 경고를 반환하고 현재 시각을 발명하지 않는다. B1의 첫 prune 건너뛰기 정책은 그 경고를 소비해야 한다.
- 기존 JSON schema1의 필드만 projection하고 복사본을 반환한다. ledger의 내부 컬럼은 구 JSON으로 흘리지 않는다.

이 함수는 파일·outbox·acked_seq·마커를 변경하지 않는다. PG commit 후 상태 파일의 원자적 저장과 import 마커 rolled-back/제거는 후속 rollback 조립 도구의 책임이다.

## z-ds 연결 요청

- 최종DDL이 위 statement의 컬럼·순서·제약과 호환되는지 확인하고 최종 migration/workerd 통합 테스트에서 batch 원자성을 다시 검증한다. 여기의 메모리SQLite 프로토콜 harness는 최종DDL 정본이 아니다.
- STRICT/typeof/JSON CHECK·receipt NOT NULL PK·부분 UNIQUE·실제 workerd64bit 문자열 왕복·PG OVERRIDING/transaction/setval은 z-ds 소유 게이트다. 이 변경으로 통과했다고 간주하지 않는다.
- 이관 SQL 도구는 전체 canonical tuple과null 표기, PG 미세초 정렬 검사, 명시적 PG 비교 대상, PG commit 후 상태 변환 순서를 사용한다.
- 계약·도구만 존재한다. 운영D1 생성·secret·플래그·수집기 기동·PG 스키마 변경을 하지 않는다.
