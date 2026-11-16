# D1 전환(Cutover) 및 롤백 런북 (ADR 0.10 §11 D)

정본: `docs/adr/0.10-d1-storage.md` §11 D. 이 문서는 운영 실행 절차·중단 조건·승인 경계를 정리한 런북이며, 실제 전환·배포는 각 단계별 **사용자 승인** 후에만 실행한다.

## 공통 원칙
- **사용자 승인 지점**: `[승인]` 표시 단계(관측 정지·PM2 변경, 백필/역이관 쓰기, Worker 플래그 배포)는 사용자 승인 없이 실행하지 않는다.
- **비밀값 비노출**: `DB_URL`, `ZZIK_D1_API_TOKEN`, `ZZIK_D1_ACCOUNT_ID`, `ZZIK_D1_DATABASE_ID`, `ALLOWED_EMAIL`, Access `Location` 전문, 원문 응답은 stdout·로그에 출력하지 않는다.
- **타임아웃**: macOS 환경에는 `timeout` 명령이 없으므로 사용하지 않는다. 도구 제한 시간은 Node 타이머(`setTimeout`)로 처리한다.
- **선행 게이트**: A·B1·B2·B3·C·E·export patch의 교차 리뷰 및 `work-reviewer` 통과 기록이 모두 있어야 D를 연다.

---

## 0. 사전 점검 (`scripts/d1-preflight.mjs` — dry-run 전용)

전환 착수 전 `scripts/d1-preflight.mjs`로 PM2 상태·`ZZIK_STORE`·ledger 존재·outbox 0·export/버킷 배포 여부·`USAGE_READ_STORE`를 값 노출 없이 `PASS`/`FAIL`로 점검한다. 기본은 읽기 전용 dry-run이며, 실제 PM2·wrangler·DB·D1을 호출하지 않는다.

```bash
node scripts/d1-preflight.mjs --state-dir <ZZIK_STATE_DIR> [--evidence <preflight-evidence.json>]
```

- **확인할 출력 형태**:
  ```json
  {"ok":true,"dryRun":true,"checks":[{"name":"pm2_process","status":"PASS"},{"name":"zzik_store","status":"PASS"},{"name":"ledger_exists","status":"PASS"},{"name":"ledger_outbox_zero","status":"PASS"},{"name":"export_bucket_deployed","status":"PASS"},{"name":"usage_read_store","status":"PASS"}]}
  ```
- **중단 조건**: `ok: false` 또는 어느 한 항목이라도 `FAIL`이면 원인을 해소할 때까지 다음 단계로 진행하지 않는다.

---

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
- **확인**: 첫 주기 후 6개 제공자 `usage_write_receipt` 및 `usage_snapshot` seq 증가를 개수·상태 코드로만 확인한다. (Worker 읽기는 아직 `postgres`다.)
- **중단 조건**: 6개 제공자 receipt/snapshot 누락, `auth` 401/403, 또는 `local_commit_failed` 발생 시 즉시 정지 후 아래 롤백 절차로 복귀한다.

### 5) Worker 읽기 플래그 `d1` 배포 `[승인]`
- export patch와 E에서 `d1_databases`, `r2_buckets`, `triggers.crons` 바인딩이 이미 배포돼 있어야 한다.
- `USAGE_READ_STORE=d1`만 변경해 `pnpm run deploy`를 실행한다(드라이버 삭제와 플래그 전환을 한 배포에 묶지 않는다).

### 6) 원격 opt-in 6개 제공자 확인
- 대상 원격 D1 + 배포된 Worker 번들로 6개 제공자 `/api/usage`, `/api/usage/:provider` 200·decode boolean 및 `/api/usage-history/:provider` id 문자열 왕복을 확인한다.
- **주의**: 기존 `tests/worker/infra/usage/db.workerd.test.ts`는 `DB_URL` 기반 PG opt-in이므로 D1 원격 게이트를 대체하지 않는다.
- 쿠키 없는 요청(`/`, `/api/usage`, `/api/usage/<provider>`) `302` 및 `workers.dev` `404`를 확인한다.

### 7) 인증된 운영 화면 확인
- 사용자가 인증된 브라우저에서 6개 제공자 최신값·7일 이력·30일 버킷 차트를 직접 확인한 뒤 전환 완료로 보고한다.

---

## 2. 롤백 순서 (G 전 무손실 경로)

1. **관측 정지 `[승인]`**: 새 관측을 중지하고 D1 모드면 sender의 진행 중 HTTP가 끝나기를 최대 30초 기다린다.
2. **drain**:
   - D1 접근 가능 시: outbox를 분류하고 미전송 operation을 **같은 operation id**로 D1에 drain한다(임의 재번호·큐 삭제 금지).
   - D1 접근 불가 시: 역이관을 시작하지 않고 사용자에게 공백(정지 시각 이후 허용 손실)을 보고한 뒤 PG 마지막 `remoteCommitted` 기준으로 복귀하는 별도 승인을 받는다.
3. **PG 단일 트랜잭션 역이관 `[승인]`**: D1 관측을 PG 단일 트랜잭션으로 역이관하고 커밋 후 트랜잭션 밖에서 sequence를 위로만 맞춘다. 해시 불일치 시 즉시 중단한다.
4. **ledger 정리 · `rolled-back` 마커 기록**: PG 커밋 성공 뒤에만 한 ledger 트랜잭션에서 역이관된 outbox 행을 삭제하고 `acked_seq`를 맞춘 뒤 현재 JSON(`gate`, `alerts`, `previous`, `lastEventAt`, `lastRun` + `usage-prune.json`의 `lastPruneAt`)을 복구하며, import 마커를 **`rolled-back`으로 표시한다(마커 삭제 금지, 이전 백업 JSON 덮어쓰기 금지)**.
5. **두 플래그 `postgres` · 간격 `900` 복구 `[승인]`**: `USAGE_READ_STORE=postgres`, `ZZIK_STORE=postgres`, 간격 `900`으로 되돌리고 capability 파일과 `ZZIK_INTERVAL_SEC_*` `180` 설정을 제거한다.
