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

PG source는 repeatable-read/read-only transaction 안에서 최대 250행씩 읽으며 consumer가 페이지를 끝낸 뒤에만 다음 페이지를 요청한다. CLI는 전체 봉투 배열이나 기본 128MiB 상한 대신 private SQLite 임시 spool(디렉터리 0700/DB 0600)에 페이지를 기록한다. source 정렬과 마이크로초 검사 후 기존 행 해시 튜플의 JSON 배열 framing을 그대로 누적하므로 기존 planSha256과 숫자 id/provider 순서가 같다. D1 사전 대조·쓰기·최종 검증도 spool을 25행 이하씩 재생하며 전체 pending/target map을 만들지 않는다. 정상 종료에는 자기 spool만 삭제하고, 비정상 종료의 private orphan은 재사용하지 않는다. 데이터가 큰 경우 필요한 자원은 전체 JS heap 대신 로컬 디스크이며 디스크 실패는 안전 중단한다.

기존 배열 `read()`/`planBackfill()` API는 호환용으로 유지한다. 명시적 `maxBytes`의 `source_limit`도 배열 API에서만 유지되며 운영 CLI는 이 메서드를 쓰지 않는다. 128MiB를 넘는 합성 2,050행을 실제 disk spool로 처리·재생하는 회귀와, pre-change golden hash·timezone/epoch 이전 시각·재기동 후 batch 재개 동등성을 검증한다. D1 조회·쓰기 모두 B2의 공유 1요청/초 query lane을 사용한다.

계획이 달라지면 기존 checkpoint로 재개하지 않는다. 최종 catch-up용 PG 관측 정지 뒤에는 새 dry-run과 새 **명시적 checkpoint 경로**로 검토한다. 대상의 기존 prefix 해시가 모두 같아야 하며 예상 밖 행은 거부한다. 도구가 checkpoint를 자동 초기화하거나 대상의 추가 행을 삭제하지 않는다.

## 전환 전 운영 안전 확인

- **격리 해제 `[승인]`**: `--resume-without-quarantine <provider>`는 D1 모드에서 PM2 collector를 정지한 직후의 유지 창에만 실행한다. 정지 전에 PM2 `kill_timeout`이 **35000ms 이상**인지 승인된 설정에서 확인하고, `pm2 stop zzik-usage-collector`로 30초 quiesce를 완료한다. 마지막 D1 요청 이후 원격 in-flight 쓰기까지 끝났다고 확인할 수 있어야 한다. PM2 stopped 표시나 HTTP 응답 유실만으로 원격 완료를 단정하지 않는다. 요청이 아직 커밋될 가능성이 남으면 실행을 중단한다. 이 명령은 **receipt 부재를 근거로 operation을 폐기**하므로 진행 중 요청과 경쟁하면 늦은 커밋을 놓칠 수 있다. 다른 writer도 멈춘 상태를 유지하고, 격리 해제 뒤 일반 수집 재기동은 별도로 승인한다. 이번 문서 변경은 ecosystem 설정을 바꾸지 않는다.
- **백필 디스크**: 백필 전에 `df -h <state-dir>`로 여유 공간을 확인한다. 전체 봉투를 담는 SQLite spool과 journal 및 기존 ledger를 위한 여유를 확보하고, 부족하거나 규모를 판단할 수 없으면 시작하지 않는다. 중단 후에는 백필 프로세스가 종료되고 해당 디렉터리를 사용하는 실행이 없는지 확인한 뒤 `ls -ld <state-dir>/backfill-plan-*`로 남은 spool을 확인한다. 정상 종료는 자기 spool을 지우지만 비정상 종료 잔여물은 재사용하지 않는다. 내용을 검토한 **자기 중단 실행의 경로 하나씩만** `rm -r -- <state-dir>/backfill-plan-<확인한-이름>`으로 수동 삭제한다. wildcard 삭제나 state-dir 전체 삭제는 금지하며 ledger·checkpoint·lock 파일을 지우지 않는다.
- **알림 확인**: Discord에 알림이 없어도 PM2 로그의 `[zzik collector] reason=` 줄을 확인한다. 예: `pm2 logs zzik-usage-collector --nostream --lines 200 | rg -F '[zzik collector] reason='`. Discord 비활성·전송 실패 시에도 해당 안전 로그가 남을 수 있다. 24시간 제한이나 손상된 알림 메타로 알림 자체가 생략된 경우에는 줄이 없을 수 있으므로, 로그 부재를 정상 판정 근거로 삼지 않는다. 로그·설정 원문 전체를 보고서에 붙이지 않는다.

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

## Wrangler OAuth 목적지 (API 토큰 없는 C 단계)

기존 streaming spool·canonical hash·확인·checkpoint·전후 대조를 그대로 사용하고 목적지 전송만 선택한다:

```sh
node --env-file=<approved-private-pg-env> scripts/d1-backfill.mjs \
  --state-dir <approved-state-dir> --checkpoint <approved-checkpoint> \
  --transport wrangler --database zzik-usage
```

기본은 dry-run이다. `--apply` 실행은 같은 프로세스가 출력한 planSha256을 검토한 뒤 `APPLY <planSha256>`을 stdin에 입력한다. preview와 apply는 동일하게 seal한 PG repeatable-read 계획을 재사용한다. PG 읽기용 DB_URL만 필요하며 D1 API 토큰·계정 ID 환경변수는 필요 없다. Wrangler의 기존 OAuth 로그인과 갱신을 사용한다. 수집기 런타임에는 이 전송을 연결하지 않는다.

SELECT는 `--command`, 쓰기는 private SQL 파일의 `--file`로 전송한다. 문자열·64비트 id를 SQL literal로 안전하게 escape하고, 모든 쓰기 문을 preview 전에 렌더링해 문장당 100,000 bytes를 검사한다. 실행 청크는 최대 21문(guard+20행)·512KiB이며 전송은 직렬·최소 1초 간격이다. 오류·불완전 응답은 자동 재시도하지 않고 중단한다. 원격 file import에는 서비스 중 질의 불가 구간이 있으므로 D1이 아직 서빙하지 않는 C 단계에서만 사용한다.

Wrangler stdout/stderr 원문과 자체 디스크 로그를 내보내지 않는다. SQL 임시 디렉터리 0700·파일 0600, 종료 후 자기 청크만 삭제한다. D1 검증 행은 메모리에서 기존 migration_row_sha256 함수로 대조하며 보고서에는 개수·id 범위·계획 해시·바이트 수만 남긴다. 응답에서 id는 CAST AS TEXT를 유지한다.

초기 C 복사는 PG 수집을 유지한 채 일관된 과거 스냅샷을 복사할 수 있다. 이 경우 완료는 그 계획과의 일치만 의미하며 복사 이후 새 PG 관측은 포함하지 않는다. D 유지 창에는 수집을 정지한 뒤 새 계획·새 checkpoint로 최종 catch-up을 해야 한다. D1 writer가 있는 상태에서 이 도구를 실행하지 않는다.

## 완전성 게이트와 잘린 초기 복사 복구

PG 페이지 반환 id는 문자열이어도 ORDER BY는 원 정수 열 `usage_event.id`로 한정한다. scan은 같은 REPEATABLE READ 안에서 독립 COUNT(*)·min/max·provider별 COUNT를 읽고, 전체 페이지 결과와 다르면 `pg_source_count_mismatch`로 ROLLBACK한다. CLI도 spool 계획과 그 집계를 비교한 뒤에만 APPLY를 허용한다. 최종 조건은 **계획 events = 그 PG 집계**와 **D1 events = 계획 events** 모두이며 계획의 자기 일치만으로 완료하지 않는다.

기존457행의 불완전 복사는 새 checkpoint·새 계획으로 복구한다. 일치하는 기존 event는 건너뛰고 누락분을 추가하며 새 snapshot은 기존 seq0 규칙으로 갱신한다. PG 수집을 유지하므로 비교는 고정된 계획 시점의 집계이고, 이후 증가분은 D 최종 catch-up 대상이다.

초기 복사 도중 cron이 만든 파생 checkpoint/boundary는 더 낮은 id를 추가해도 재스캔하지 않는다. 이 복구에서는 승인된 유지 작업으로 `usage_bucket_boundary`와 `usage_bucket_checkpoint`만 같은 remote SQL file import에서 비우고 다음 정상15분 cron이 다시 만들게 한다. checkpoint 없음→id0 경로를 사용한다. 원시 usage_event·usage_snapshot·receipt·export log는 삭제하지 않고 Worker 배포·플래그·세대도 바꾸지 않는다. cron 경계를 피하고, 초기화 뒤 raw 건수·min/max·해시 보존과 다음 cron의 provider별 고수위·경계를 전체 raw의 독립 fold와 비교한다. 진행 중이면 미완료로 보고하며 완료로 처리하지 않는다. 일반 캐시 세대 갱신과 구분한다.
