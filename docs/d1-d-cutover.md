# D1 전환(Cutover) 및 롤백 런북 (ADR 0.10 §11 D)

정본: `docs/adr/0.10-d1-storage.md` §11 D. 이 문서는 운영 실행 절차·중단 조건·승인 경계를 정리한 런북이며, 실제 전환·배포는 각 단계별 **사용자 승인** 후에만 실행한다.

## 공통 원칙
- **사용자 승인 지점**: `[승인]` 표시 단계(관측 정지·PM2 변경, 백필/역이관 쓰기, Worker 플래그 배포, 원격 opt-in)는 사용자 승인 없이 실행하지 않는다.
- **비밀값 비노출**: `DB_URL`, `ZZIK_D1_API_TOKEN`, `ZZIK_D1_ACCOUNT_ID`, `ZZIK_D1_DATABASE_ID`, `ALLOWED_EMAIL`, Access `Location` 전문, 원문 응답은 stdout·로그에 출력하지 않는다.
- **타임아웃**: macOS 환경에는 `timeout` 명령이 없으므로 사용하지 않는다. 도구 제한 시간은 Node 타이머(`setTimeout`)로 처리한다.
- **선행 게이트**: A·B1·B2·B3·C·E·export patch의 교차 리뷰 및 `work-reviewer` 통과 기록이 모두 있어야 D를 연다.

---

## 0. 사전 점검 (`scripts/d1-preflight.mjs` — dry-run 전용)

전환 착수 전 `scripts/d1-preflight.mjs`로 PM2 상태·`ZZIK_STORE`·ledger 존재·outbox 0·export/버킷 배포 여부·`USAGE_READ_STORE`를 값 노출 없이 `PASS`/`FAIL`로 점검한다. 기본은 읽기 전용 dry-run이며, 실제 PM2·wrangler·DB·D1을 호출하지 않는다.

```bash
node scripts/d1-preflight.mjs --state-dir <ZZIK_STATE_DIR> [--evidence <preflight-evidence.json>] \
  [--expected-pm2-status online|stopped|any] \
  [--expected-zzik-store postgres|d1] \
  [--expected-read-store postgres|d1]
```

- **기본 기대값(전환 전)**: `--expected-pm2-status online`, `--expected-zzik-store postgres`, `--expected-read-store postgres`. 이미 `ZZIK_STORE`/`USAGE_READ_STORE`가 `d1`이면 기본값에서 FAIL이므로 전환 전 상태를 확인한다. 롤백 뒤/재전환 전 점검처럼 기대값이 다르면 플래그로 명시한다.
- **확인할 출력 형태**:
  ```json
  {"ok":true,"dryRun":true,"checks":[{"name":"pm2_process","status":"PASS"},{"name":"zzik_store","status":"PASS"},{"name":"ledger_exists","status":"PASS"},{"name":"ledger_outbox_zero","status":"PASS"},{"name":"export_bucket_deployed","status":"PASS"},{"name":"usage_read_store","status":"PASS"}]}
  ```
- **종료 코드**: `--help`는 0, 인자 오류는 64, evidence 없음/파싱 오류/`preflight_failed`는 1, 검사 항목 `FAIL`은 1이다.
- **중단 조건**: `ok: false` 또는 어느 한 항목이라도 `FAIL`이면 원인을 해소할 때까지 다음 단계로 진행하지 않는다.

---

## 전환 전 운영 안전 확인

- **격리 해제 `[승인]`**: `--resume-without-quarantine <provider>`는 D1 모드에서 PM2 collector를 정지한 직후의 유지 창에만 실행한다. 정지 전에 PM2 `kill_timeout`이 **35000ms 이상**인지 승인된 설정에서 확인하고, `pm2 stop zzik-usage-collector`로 30초 quiesce를 완료한다. 마지막 D1 요청 이후 원격 in-flight 쓰기까지 끝났다고 확인할 수 있어야 한다. PM2 stopped 표시나 HTTP 응답 유실만으로 원격 완료를 단정하지 않는다. 요청이 아직 커밋될 가능성이 남으면 실행을 중단한다. 이 명령은 **receipt 부재를 근거로 operation을 폐기**하므로 진행 중 요청과 경쟁하면 늦은 커밋을 놓칠 수 있다. 다른 writer도 멈춘 상태를 유지하고, 격리 해제 뒤 일반 수집 재기동은 별도로 승인한다. 이번 문서 변경은 ecosystem 설정을 바꾸지 않는다.
- **백필 디스크**: 백필 전에 `df -h <state-dir>`로 여유 공간을 확인한다. 전체 봉투를 담는 SQLite spool과 journal 및 기존 ledger를 위한 여유를 확보하고, 부족하거나 규모를 판단할 수 없으면 시작하지 않는다. 중단 후에는 백필 프로세스가 종료되고 해당 디렉터리를 사용하는 실행이 없는지 확인한 뒤 `ls -ld <state-dir>/backfill-plan-*`로 남은 spool을 확인한다. 정상 종료는 자기 spool을 지우지만 비정상 종료 잔여물은 재사용하지 않는다. 내용을 검토한 **자기 중단 실행의 경로 하나씩만** `rm -r -- <state-dir>/backfill-plan-<확인한-이름>`으로 수동 삭제한다. wildcard 삭제나 state-dir 전체 삭제는 금지하며 ledger·checkpoint·lock 파일을 지우지 않는다.
- **알림 확인**: Discord에 알림이 없어도 PM2 로그의 `[zzik collector] reason=` 줄을 확인한다. 예: `pm2 logs zzik-usage-collector --nostream --lines 200 | rg -F '[zzik collector] reason='`. Discord 비활성·전송 실패 시에도 해당 안전 로그가 남을 수 있다. 24시간 제한이나 손상된 알림 메타로 알림 자체가 생략된 경우에는 줄이 없을 수 있으므로, 로그 부재를 정상 판정 근거로 삼지 않는다. 로그·설정 원문 전체를 보고서에 붙이지 않는다.

## 1. 정방향 전환 순서 (유지 창)

### 1) 관측 정지 `[승인]`
```bash
pm2 stop zzik-usage-collector
```
- **확인**: B3의 30초 quiesce 유예 내 종료 및 Antigravity CLI 자식 프로세스 잔존 없음(`pgrep -fl agy` 등)을 확인한다.
- **중단 조건**: 자식 프로세스나 in-flight 요청이 정리되지 않으면 진행하지 않는다.

### 2) drain
- **최초 PG → D1 전환**: PG 모드에는 outbox가 없으므로 PG in-flight 트랜잭션 완료만 확인한다. (D1 모드에서 재전환·실패 복구일 때만 UUID 기반 outbox drain을 수행한다.)

### 3) 최종 백필 (`scripts/d1-backfill.mjs`) `[승인]`
먼저 dry-run으로 계획을 생성하고 요약을 확인한다:
```bash
node --env-file=<private-env> scripts/d1-backfill.mjs --state-dir <ZZIK_STATE_DIR>
```
- **확인할 출력 형태 (dry-run)**:
  - `{"ok":true,"value":{"planSha256":"<64-hex>", ...}}` (건수·min/max id 문자열·`migration_row_sha256` 포함, 원문·비밀값 없음)
  - 사전 불변식: `receipt = 0`, `usage_snapshot.write_seq = 0`, `operation_id = NULL`, `ledger outbox = 0`, `sqlite_sequence >= max(id)`.
- 계획 확인 및 승인 후 `--apply` 실행:
  ```bash
  node --env-file=<private-env> scripts/d1-backfill.mjs --state-dir <ZZIK_STATE_DIR> --apply
  ```
  프롬프트에 `APPLY <planSha256>`을 정확히 입력한다.
- **중단 조건**: `ledger_outbox_not_empty`(exit 78), `jsonb` 비객체 행, 해시 불일치, `sqlite_sequence` 펜스 미달 시 즉시 중단한다.

### 4) 수집기 `d1` 기동 (간격 900, capability 없음) `[승인]`
- **주의**: `collector/ecosystem.config.cjs`에 `ZZIK_STORE=postgres`가 명시돼 있으면 private env-file만 바꿔서는 전환되지 않는다. 승인된 설정으로 `ZZIK_STORE=d1`, 간격 `900`, capability 파일 없음 상태를 맞춘 뒤 기동한다.
  ```bash
  pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env
  ```
- **확인**: 첫 주기 후 6개 제공자 `usage_write_receipt` 및 `usage_snapshot` seq 증가를 개수·상태 코드로만 확인한다. **첫 전환의 다음 `write_seq`는 1**이어야 하며, 1이 아니면 잔여 세대/재전환 상태로 보고 중단한다. (Worker 읽기는 아직 `postgres`다.)
- **중단 조건**: 6개 제공자 receipt/snapshot 누락, `auth` 401/403, 또는 `local_commit_failed` 발생 시 즉시 정지 후 아래 롤백 절차로 복귀한다.

### 5) Worker 읽기 플래그 `d1` 배포 `[승인]`
- export patch와 E에서 `d1_databases`, `r2_buckets`, `triggers.crons` 바인딩이 이미 배포돼 있어야 한다.
- `USAGE_READ_STORE=d1`만 변경해 `pnpm run deploy`를 실행한다(드라이버 삭제와 플래그 전환을 한 배포에 묶지 않는다).

### 6) 원격 opt-in 6개 제공자 확인 `[승인]`
- 대상 원격 D1 + 배포된 Worker 번들로 6개 제공자 `/api/usage`, `/api/usage/:provider` 200·decode boolean 및 `/api/usage-history/:provider` id 문자열 왕복을 확인한다.
- **주의**: 기존 `tests/worker/infra/usage/db.workerd.test.ts`는 `DB_URL` 기반 PG opt-in이므로 D1 원격 게이트를 대체하지 않는다.
- 쿠키 없는 요청(`/`, `/api/usage`, `/api/usage/<provider>`) `302` 및 `workers.dev` `404`를 확인한다.

### 7) 인증된 운영 화면 확인
- 사용자가 인증된 브라우저에서 6개 제공자 최신값·7일 이력·30일 버킷 차트를 직접 확인한 뒤 전환 완료로 보고한다.
- **F 진입**: 이 화면 확인에서 큰 문제가 없으면 72시간 대기나 900초 주기 2회 확인 없이 바로 F로 진입한다(4절). 문제가 있으면 2절 롤백을 먼저 검토한다.

---

## 2. 롤백 순서 (G 전 무손실 경로)

1. **관측 정지 `[승인]`**: 새 관측을 중지하고 D1 모드면 sender의 진행 중 HTTP가 끝나기를 최대 30초 기다린다.
2. **drain**:
   - D1 접근 가능 시: outbox를 분류하고 미전송 operation을 **같은 operation id**로 D1에 drain한다(임의 재번호·큐 삭제 금지).
   - D1 접근 불가 시: 3·4항을 건너뛰고 **즉시 5항의 두 플래그를 `postgres`로 되돌린다.** 화면은 정지 시각까지의 PG로 복구하며, **그 구간의 알림은 다시 보내지 않는다.** JSON `previous`는 PG 마지막 `remoteCommitted`로 두고 이전 백업 JSON으로 덮지 않는다. 사용자에게 공백(정지 시각 이후 허용 손실)을 보고하고 별도 승인을 받는다.
3. **PG 단일 트랜잭션 역이관 `[승인]`**: D1 관측을 PG 단일 트랜잭션으로 역이관하고, **receipt는 PG 표로 복사하지 않는다.** 커밋 후 트랜잭션 밖에서 sequence를 위로만 맞추고 **다음 기본 id가 `max(id)+1`인지 확인한다.** 해시 불일치 시 즉시 중단한다. **setval·다음 id 확인·4항 완료 전에는 수집기를 켜지 않는다.**
4. **ledger 정리 · `rolled-back` 마커 기록**: PG 커밋 성공 뒤에만 한 ledger 트랜잭션에서 역이관된 outbox 행을 삭제하고 `acked_seq`를 맞춘 뒤 현재 JSON(`gate`, `alerts`, `previous`, `lastEventAt`, `lastRun` + `usage-prune.json`의 `lastPruneAt`)을 복구하며, import 마커를 **`rolled-back`으로 표시한다(마커 삭제 금지, 이전 백업 JSON 덮어쓰기 금지)**. **PG 커밋과 이 ledger 트랜잭션 사이에 종료되면 역이관을 재실행하고, 같은 해시는 건너뛰고 outbox 삭제를 다시 한다.**
5. **두 플래그 `postgres` · 간격 `900` 복구 `[승인]`**: `USAGE_READ_STORE=postgres`, `ZZIK_STORE=postgres`, 간격 `900`으로 되돌리고 capability 파일과 `ZZIK_INTERVAL_SEC_*` `180` 설정을 제거한다. 2항의 D1 접근 불가 경로에서는 이미 이 플래그 복구를 시작했고, 3·4항의 역이관/ledger 정리는 수행하지 않는다.

---

## 3. 재전환 규칙 (ADR 0.10 §11 D)

- JSON 재import는 마커가 `rolled-back`일 때만 한다. 그때는 롤백 전에 쓰던 ledger의 `previous`, `lastEventAt`, `gate`를 이어서 쓰지 않는다.
- 마커가 없고 SQLite가 있으면 커밋 직후 마커 rename 전 종료로 보고 기존 ledger를 열며, JSON을 재import하지 않는다.
- D1이 비어 있으면(receipt 0, `write_seq` 최댓값 0, 새 ledger outbox 0) 첫 전환과 같은 백필을 하고 다음 `write_seq`는 1이다.
- 2항의 D1 접근 불가 경로가 아닌 재전환에서 D1에 이전 세대가 남아 있으면 전량 백필을 다시 하지 않는다. PG에만 있는 id만 해시 대조 후 넣고, 그 행의 `operation_id`는 NULL로 둔다. 다음 `write_seq`는 ADR §5.1 식이다.
- 2항의 D1 접근 불가 경로로 돌아간 뒤의 재전환은 D1 표를 비우고 `data_generation`을 올린 뒤 첫 전환과 같은 전량 백필을 한다(그 D1 잔여 관측은 이미 허용 손실로 선언됨).
- 재전환 기동 전에 `previous`와 `lastEventAt`이 `remoteCommitted`와 같은지 확인한다. 다르면 그 값으로 맞춘 뒤에 켠다.

재시작은 주기 사이에 하고, 운영 승인 시 quiesce 30초보다 긴 PM2 `kill_timeout`(예: 35000ms)을 권고한다(기존 ecosystem 설정은 변경하지 않는다).

---

## 4. 이후 단계 진입 조건 (2026-11-16 사용자 결정 단축)

정본: `docs/adr/0.10-d1-storage.md` 결정표(§2.1), §11 F·G. 개인용 대시보드라 72시간 관측은 과잉이다.

- **F**: D 직후 인증된 운영 화면 확인에서 큰 문제가 없으면 대기 없이 바로 진입한다. 72시간 관측 기간과 900초 주기 2회 확인은 요구하지 않는다. claude는 900으로 두고 codex·antigravity·opencode·grok·ollama 다섯 제공자에 `ZZIK_INTERVAL_SEC_*=180`과 capability 파일을 함께 쓴다. 429 관측과 provider별 900 복귀는 F 이후 운영 중 감시로 유지한다.
- **G**: F 이후 하루 이상 정상 수집이 이어지고 R2 export가 최소 1회 성공(일자 객체 1개 이상, 이벤트 고수위 단조)하면 G1을 열 수 있다. G1은 postgres.js·`DB_URL` 제거다. `DB_URL` secret 제거와 Neon 프로젝트 삭제(G2)는 비가역이므로 **별도 사용자 승인**이 필요하다.
