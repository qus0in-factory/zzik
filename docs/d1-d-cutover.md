# D 전환 런북 — WIP, 실행 금지

주간 잔여 1% 도달 지시에 따라 조사 단계에서 중단한 초안이다. 단계별 실행 명령·점검 스크립트·테스트는 아직 작성하지 않았다. 이 문서는 운영 실행 승인이 아니며 현재 상태로 전환하지 않는다.

## 확인한 정본과 승인 경계

- ADR `docs/adr/0.10-d1-storage.md` §11 D가 순서의 정본이다.
- `.agents/skills/zzik-deploy/SKILL.md`, `.agents/skills/zzik-usage-collector/SKILL.md`의 현재 본문은 PG 운영 기준이다. D1 전환에는 ADR의 단계별 별도 승인과 핵심 경로 두 리뷰 관문이 우선한다.
- 관측 정지/PM2 변경, D1/PG 접근과 쓰기, Worker 배포·플래그 변경은 각각 사용자 승인 지점이다. 비밀값·Location 전문·응답 원문은 출력하지 않는다.
- 이 환경에는 `timeout`이 없다. 후속 도구의 제한 시간은 Node 포트/타이머로 구현해야 한다.

## 정방향 순서 — 명령 미작성

1. A/B/C/E/export 및 B3 리뷰 수정본의 게이트 기록과 운영 배포본을 대조한다. 기록이 없으면 중단한다.
2. 승인 후 PG 관측을 정지하고 B3의 30초 quiesce 결과와 Antigravity 자식 종료를 확인한다.
3. PG in-flight transaction 종료를 확인한다. **PG 모드에는 outbox가 없으므로 이 단계의 drain은 PG in-flight 완료 확인이다.** D1의 UUID ack/응답 유실/미전송 분류로 대체하지 않는다.
4. 승인 후 receipt=0, snapshot seq=0/op=NULL, ledger outbox=0, hash/id/sequence 펜스를 다시 확인하고 최종 백필한다.
5. 승인 후 collector를 d1·900초·capability 없음으로 기동하고 6제공자 receipt/snapshot을 확인한다. Worker 읽기는 아직 PG다.
6. 승인 후 Worker 읽기 플래그만 d1로 배포한다. binding/export/bucket은 이미 배포돼 있어야 한다.
7. 대상 D1과 배포 번들을 사용하는 원격 opt-in으로 6제공자 200/decode, history id 문자열을 확인한다. Access 302/workers.dev 404와 인증된 화면 확인은 별도 필수다.

## 롤백 순서 — 명령 미작성

1. 승인 후 새 관측을 막고 현재 sender HTTP까지 최대 30초 기다린다.
2. D1 접근 가능 시 outbox를 분류하고 미전송은 **같은 operation id**로 drain한다. 실패하면 임의 재번호나 큐 삭제를 하지 않는다.
3. 승인 후 D1 관측을 PG 단일 transaction으로 역이관하고 commit 뒤 sequence를 위로만 맞춘다. hash 충돌이면 중단한다.
4. PG commit 확인 뒤 ledger의 outbox 정리와 rolled-back 내부 마커를 한 transaction으로 기록하고 현재 JSON을 복구한다. C의 finalizeLedgerRollback 계약을 검토해 연결해야 한다. 이전 백업 JSON으로 덮거나 마커를 삭제하지 않는다.
5. 두 플래그 postgres, 간격 900으로 복구한다. provider별 180 override와 capability는 승인된 절차로 제거한다.
6. D1을 열 수 없으면 역이관을 시도하지 않는다. ADR의 허용 손실 경로를 사용자에게 명시하고 PG 마지막 remoteCommitted 기준으로 복귀하는 별도 승인 절차가 필요하다.

## 조사에서 확인한 실행 차단 사항

- 현재 `collector/ecosystem.config.cjs`는 `ZZIK_STORE=postgres`를 명시한다. private env-file만 d1로 바꾸고 기존 ecosystem을 재시작해서 전환됐다고 판단하면 안 된다. runtime/saved 설정 대조 및 비밀값을 PM2에 복제하지 않는 변경 명령을 후속 구현에서 확정해야 한다.
- 현재 `tests/worker/infra/usage/db.workerd.test.ts`는 DB_URL 기반 **PG opt-in**이다. D1 원격 게이트로 재사용해 PASS라고 기록할 수 없다. z-ds의 대상 D1·배포 번들 opt-in 경로를 받아야 한다.
- 이 브랜치의 Worker 조립/설정에서 D1 읽기 플래그·export/bucket 배포 증거는 아직 확인되지 않았다. 파일이 있다는 이유나 로컬 테스트로 배포 여부를 PASS 처리하지 않는다.
- B3 수정 브랜치와 겹치는 파일: `collector/app/usage/d1-maintenance.mjs`, ADR, B2 문서 및 maintenance 테스트. 이 작업에서 수정하지 않았다.

## 재개할 작업

신규 파일로 dry-run 기본 preflight와 가짜 PM2/ledger/배포 증거 포트, 실패 테스트를 먼저 작성한다. 기본 모드에서 운영 명령을 실행하지 않게 한다. 실제 읽기 probe는 별도 명시적 opt-in/승인으로 제한하고 PM2 원문·환경 값은 메모리 안에서 PASS/FAIL로 축약한다. 단계별 명령·확인 출력·중단/복구 조건을 완성한 뒤 5개 필수 검사를 실행한다.
