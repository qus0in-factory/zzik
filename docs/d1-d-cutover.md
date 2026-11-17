# D1 단독 운영·G1 적용 런북

정본: ADR 0.10 G1, 2026-11-17 사용자 지시. D·F 전환은 완료됐다. G1 코드는 준비 상태이며 배포/병합/PM2 반영은 opus가 수행한다. 12:00 export 대기 없이 준비가 끝나면 적용한다. **Neon과 DB_URL secret/.env는 그대로 둔다.**

## 반영 순서

1. opus가 작업 브랜치를 dev에 반영하고 dev→main PR을 병합한다. 12:00 export는 기다리지 않는다.
2. release를 준비하고 status가 비어 있는지 확인한다.

```sh
cd /Users/young-mini/Workspace/zzik/.worktree/release
git pull --ff-only
pnpm install --frozen-lockfile
git status --short
```

3. ADR 0.1 계정 일치를 확인한다. Wrangler whoami 출력은 메모리에서 캡처하고 계정 일치 Boolean만 출력한다. 계정 ID·이메일·토큰은 출력하거나 파일에 저장하지 않는다.
4. **Worker 먼저**: 아래 도구가 D1 workerd 사전 검사 후 pnpm run deploy를 호출한다. 외부 명령 원문은 출력하지 않는다.

```sh
node scripts/deploy-verify.mjs --release "$PWD" --deploy > /tmp/zzik-g1-deploy.json
```

5. 결과의 모든 gate와 실제 D1 최신값·이력 문자열 id·30일 bucket을 확인한다. 쿠키 없는 8경로와 bucket 302·Access login·앱 데이터 비노출 및 verify도 확인한다. 실패하면 수집기를 바꾸기 전에 중단한다. 로컬 workerd는 인증된 운영 API 검증의 대체물이 아니다.
6. **수집기 다음**: 수집 주기 사이에 실행한다. 기본 env가 D1이므로 named --env d1을 붙이지 않는다.

```sh
pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env
pm2 save
```

7. runtime/saved D1·다섯 180초/Claude 900초·전용 profile·release cwd/env-file·kill_timeout 35000을 값 비노출로 대조한다. receipt/snapshot seq와 local ack, outbox, 429, authStopped, 알림을 확인한다. 기존 nextDue 보존을 고려하고 상태나 게이트를 초기화하지 않는다.

## 복구 경계

G1 실행 경로에는 PG reader/writer/백필/역이관이 없다. `ZZIK_STORE=postgres`는 78, Worker의 오래된 postgres selector는 503이다. D1 바인딩 없으면 503이다. 정상 기본은 D1이다.

D1 장애는 forward-fix 또는 R2 export→scratch D1 복원→행수/해시/id 고수위/outbox 재생 검증으로 대응한다. 운영 D1을 덮어쓰지 않는다. 필요하면 G1 이전 코드 복귀를 별도 검토하지만 자동 PG 복귀/무손실을 보장하지 않는다. PG에 남은 데이터는 D 전환 이후 갱신되지 않았다.

## 상태·보안

capability는 state-dir/interval-capability.json `{ "v":1,"readStore":"d1","bucketRoute":true }`, 0600이다. 180초 불허/손상 시 안전하게 실패한다. provider 429는 해당 override를 900으로 실제 반영하고, D1 쓰기/인증/오래된 outbox는 전체 900 복귀 또는 수집 정지 후 보고한다. PM2는 기존 env를 병합하므로 키를 파일에서 지운 것만으로 운영 env 삭제를 단정하지 않는다.

알림이 Discord에 없어도 안전한 `[zzik collector] reason=`을 확인한다. 비밀값/원문/Location 전문을 출력하지 않는다. 격리 해제는 collector 정지·quiesce 완료·마지막 원격 in-flight 종료 확인 후에만 가능하다. 디스크 여유를 먼저 확인하고, 중단된 백필 spool은 자기 경로만 수동 정리한다. 상태/게이트/토큰 파일을 초기화하지 않는다.

G2(DB_URL secret 삭제·Neon 삭제)는 이번 범위에서 금지한다. export 성공/보존 상태 확인과 비가역 삭제는 별도 작업이다.
