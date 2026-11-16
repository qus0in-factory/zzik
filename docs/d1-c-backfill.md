# C 백필 도구와 승인 후 원격 게이트

이 patch는 코드·로컬 검증이다. 운영 PG 읽기, 운영 D1 생성/적용/쓰기, 수집기 정지·재시작은 실행하지 않는다. 운영 실행에는 별도 승인과 핵심 경로 리뷰 두 관문이 필요하다.

## 기본 동작

```sh
node scripts/d1-backfill.mjs --help
```

CLI는 dry-run 기본이다. 명시적인 state directory와 private env-file이 있어야 읽기를 시작한다. dry-run은 PG의 repeatable-read/read-only 트랜잭션과 D1 SELECT로 검사하며 D1 행이나 PG 행을 쓰지 않는다. 잠금·요청 간격 상태 파일은 로컬 private directory에 만든다. `.env`를 자동으로 읽지 않는다.

실제 D1 쓰기는 `--apply`와 해당 계획의 `APPLY <planSha256>` 확인 입력이 모두 있어야 한다. `--yes`나 확인을 생략하는 환경변수는 없다. 확인이 틀리거나 EOF면 데이터 쓰기를 하지 않는다. 실제 실행 예시는 아래 승인 후 절차에만 있다.

출력은 개수·정규화한 10진 id 문자열·계획 SHA-256·safe reason/cursor다. envelope, rawText, 계정/DB id, URL, 토큰, 예외 원문은 출력하지 않는다. 각 행의 migration_row_sha256은 기존 A 함수를 재사용하며 canonical envelope 전체를 포함한다. 계획 해시는 정렬된 행 키·행 해시·snapshot updatedAt에서 계산한다.

## 검사와 재개

1. PG jsonb_typeof가 object 아닌 행은 즉시 중단한다. 전체 마이크로초 UTC 문자열을 읽고 `checkMigrationTimeOrder`를 실행한 뒤 ms로 자른다. id는 끝까지 문자열이며 숫자 변환하지 않는다.
2. B1과 같은 process-lifetime SQLite 잠금을 얻는다. 기존 ledger는 read-only로 읽고 outbox>0이면 거부한다. marker가 있는데 DB가 없거나 DB가 깨졌으면 중단한다. 첫 전환의 ledger 미생성은 outbox=0이다.
3. D1 receipt=0, 모든 snapshot write_seq=0/operation_id=NULL, event operation_id=NULL이어야 한다. 기존 행은 전체 envelope 해시가 같은 경우만 건너뛴다. 다른 event payload, 같은 시각의 다른 snapshot, 오래된 snapshot은 중단한다. 더 새로운 PG snapshot은 seq 0 상태에서만 갱신한다.
4. 모든 충돌을 쓰기 전에 조사한다. 각 쓰기 batch에도 동일한 영속 전제 guard를 넣어 그 사이 runtime writer가 들어와도 batch 전체를 실패시킨다. guard는 전제 위반 때 NOT NULL 실패를 일으키며 정상일 때 행을 만들지 않는다.
5. 기본 batch는 최대 20행·512KiB다. 성공한 batch 뒤에만 private checkpoint를 atomic rename/fsync한다. checkpoint에는 planSha256/completed만 있다. 재실행은 checkpoint를 맹신하지 않고 실제 D1 행의 전체 해시를 다시 확인해 커밋된 행을 건너뛴다. 마지막 D1 commit 뒤 checkpoint 실패도 동일하게 재개한다.
6. 마지막으로 모든 envelope 해시·개수·max id와 sqlite_sequence≥max id를 다시 읽어 검증한다. 이미 sequence가 max id보다 작으면 dry-run에서도 거부한다. sqlite_sequence를 내려 쓰지 않는다.

PG source는 250행씩 읽으며 메모리 상한을 기본 128MiB로 둔다. 이 상한을 넘으면 일반 safe failure로 중단한다. 더 큰 원본은 승인된 별도 streaming 확장이 필요하며 이 patch는 무제한 메모리 처리를 주장하지 않는다. D1 조회·쓰기 모두 B2의 공유 1요청/초 query lane을 사용한다.

계획이 달라지면 기존 checkpoint로 재개하지 않는다. 최종 catch-up용 PG 관측 정지 뒤에는 새 dry-run과 새 **명시적 checkpoint 경로**로 검토한다. 대상의 기존 prefix 해시가 모두 같아야 하며 예상 밖 행은 거부한다. 도구가 checkpoint를 자동 초기화하거나 대상의 추가 행을 삭제하지 않는다.

## 승인 후 실행 절차 — 이번 작업에서 실행하지 않음

1. 리뷰 두 관문과 운영 PG 읽기/대상 D1 생성·마이그레이션·쓰기 승인을 따로 받는다. 대상 스키마는 `worker/migrations/0001_d1_storage.sql` 정본으로 담당자가 적용한다. 이 도구는 DB나 DDL을 생성하지 않는다. 설정의 토큰·id는 private env-file에만 두고 출력하지 않는다.
2. **먼저 별도 승인된 scratch D1**에서 아래 원격 재실행 게이트를 합성 PG/PGlite 자료로 수행한다. 운영 DB에 fault injection을 하지 않는다.
3. 최종 유지 창에서 PG 새 관측을 quiesce하고 D1 collector/cron writer가 없는지 확인한다. D1 source/target과 source 계획을 고정한다. 로컬 잠금만으로 다른 호스트의 writer나 PG 수집까지 멈췄다고 보지 않는다.
4. 승인된 private 경로만 넣어 dry-run한다.

```sh
node --env-file=<approved-private-env> scripts/d1-backfill.mjs \
  --state-dir <approved-state-dir> --checkpoint <approved-private-checkpoint>
```

5. 개수·id 범위·계획 해시와 0 전제를 검토한 뒤 동일 인자에 `--apply`를 붙인다. 프롬프트에 표시된 `APPLY <planSha256>`을 직접 입력한다. 값이나 Location/응답 원문을 로그로 남기지 않는다.
6. 실패하면 stdout의 safe reason/completed만 기록한다. 원본이 그대로면 같은 checkpoint로 재실행한다. 원본이 바뀌었으면 자동 덮어쓰기하지 않고 새 계획을 검토한다.
7. 성공 후 동일 source 계획으로 dry-run을 다시 하고 모든 개수·해시·id/sequence 펜스를 확인한다. 운영에서는 확인용 가짜 event를 삽입하지 않는다. 그 다음 단계의 배포/설정은 이 명령이 하지 않는다.

### scratch D1의 승인 후 원격 재실행 항목

로컬 `tests/collector/app/usage/d1-backfill.workerd.test.ts`의 합성 source와 port 구성을 사용하되 query port만 승인한 scratch REST client로 바꾼 별도 검수 harness에서 실행한다. 이 patch는 그 원격 harness를 자동 실행하지 않는다.

- 중간 및 마지막 SQL 실패: 정상 guard+행들 사이/끝에 유효 SQL인 `INSERT INTO usage_write_receipt(operation_id) VALUES(NULL)`을 넣어 실행 시 제약 위반을 만든다. 해당 batch의 이전 행도 커밋되지 않는지 개수/해시로 확인한 뒤 정상 batch로 재실행한다.
- 중간 및 마지막 HTTP 실패: 1행 batch의 두 번째/마지막 호출을 포트에서 실패로 돌려주고 정상 port로 같은 계획을 재실행한다. id 중복·행 수 증가가 없어야 한다.
- 커밋 후 응답/로컬 checkpoint 유실: 실제 성공을 받았어도 checkpoint 쓰기를 실패로 주입한다. 다음 실행이 실제 행 해시를 확인해 skip하는지 본다.
- 다른 payload: 같은 id의 envelope 한 필드를 바꾼 계획을 새 checkpoint로 제출한다. 기존 내용을 덮지 않고 migration_hash_mismatch여야 한다.
- 오래된 seq: 합성 runtime operation을 기존 A batch로 넣어 snapshot seq>0/receipt>0을 만든 뒤 C seq 0 백필을 시도한다. 거부하고 새 snapshot을 그대로 유지해야 한다. guard 앞/뒤 race도 확인한다.
- id: safe integer 초과의 문자열 id를 복사하고 SELECT CAST로 왕복한다. **scratch에서만** 다음 기본 id 삽입이 max보다 큰지 확인한다. 운영은 sqlite_sequence 읽기 펜스만 확인한다.

## 역이관 리허설 및 로컬 마무리

PG 역이관은 기존 `worker/infra/usage/pg-rollback.ts`를 재사용한다. event/snapshot은 한 PG transaction, setval은 commit 뒤·위로만, 같은 id 다른 해시는 중단한다. 로컬 리허설에서 실제 PGlite와 큰 문자열 id로 다음 기본 삽입까지 확인한다.

`finalizeLedgerRollback`은 **호출자가 PG 커밋을 확인하고 모든 pending receipt를 drain/대조한 뒤**에만 호출하는 helper다. D 단계 운영 rollback orchestration/CLI를 대신하지 않는다. PG 마지막 관측 사실을 받아 기존 ledgerToLegacyState로 현재 gate/alerts/lastRun 및 PG previous/lastEventAt/prune JSON을 만든다.

outbox 삭제·ackedSeq 갱신·복구 JSON 저장·내부 initialized=rolled-back은 한 SQLite transaction이다. JSON 파일과 외부 마커는 그 commit 뒤에 mirror한다. 파일 쓰기 실패면 rollback_files_pending을 반환하며, 재실행은 이미 커밋된 rollback_json에서 파일만 복구한다. 외부 marker=active인데 내부 initialized=rolled-back인 틈은 B1 부팅이 fail closed한다. 외부 rolled-back 마커는 JSON 파일을 모두 쓴 다음 마지막에 기록한다.

리허설은 local DELETE trigger 실패를 주입해 outbox와 내부 마커가 함께 rollback됨을 확인하고, commit 뒤 JSON rename 실패·재개·B1 fresh JSON import까지 확인한다. 운영 PG/D1/ledger에는 이 절차를 실행하지 않았다.
