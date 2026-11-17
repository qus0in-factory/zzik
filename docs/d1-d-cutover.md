# D1 단독 운영·G1 적용 런북

정본: ADR0.10 G1,2026-11-17 사용자 지시. D·F 전환은 완료됐다. G1 코드는 준비 상태이며 배포/병합/PM2 반영은 opus가 수행한다.12:00 export 대기 없이 준비가 끝나면 적용한다. **Neon과 DB_URL secret/.env는 그대로 둔다.**

## 반영 순서

1. opus가 작업 브랜치를 dev에 반영하고 dev→main PR을 병합한다.12:00 export는 기다리지 않는다.
2. release를 준비하고 status가 비어 있는지 확인한다.

```sh
cd /Users/young-mini/Workspace/zzik/.worktree/release
git pull --ff-only
pnpm install --frozen-lockfile
git status --short
```

3. ADR0.1 계정 일치를 확인한다. Wrangler whoami 출력은 메모리에서 캡처하고 계정 일치 Boolean만 출력한다. 계정 ID·이메일·토큰은 출력하거나 파일에 저장하지 않는다.
4. **Worker 먼저**: 아래 도구가 D1 workerd 사전 검사 후 pnpm run deploy를 호출한다. 외부 명령 원문은 출력하지 않는다.

```sh
node scripts/deploy-verify.mjs --release "$PWD" --deploy > /tmp/zzik-g1-deploy.json
```

5. 결과의 모든 gate와 실제 D1 최신값·이력 문자열 id·30일 bucket을 확인한다. 쿠키 없는8경로와 bucket302·Access login·앱 데이터 비노출 및 verify도 확인한다. 실패하면 수집기를 바꾸기 전에 중단한다. 로컬 workerd는 인증된 운영 API 검증의 대체물이 아니다.
6. **수집기 다음**: 수집 주기 사이에 실행한다. 기본 env가 D1이므로 named --env d1을 붙이지 않는다.

```sh
pm2 restart collector/ecosystem.config.cjs --only zzik-usage-collector --update-env
pm2 save
```

7. runtime/saved D1·다섯180초/Claude900초·전용 profile·release cwd/env-file·kill_timeout35000을 값 비노출로 대조한다. receipt/snapshot seq와 local ack, outbox,429,authStopped,알림을 확인한다. 기존 nextDue 보존을 고려하고 상태나 게이트를 초기화하지 않는다.

## 복구 경계

G1 실행 경로에는 PG reader/writer/백필/역이관이 없다. `ZZIK_STORE=postgres`는78, Worker의 오래된postgres selector는503이다. D1 바인딩 없으면503이다. 정상 기본은D1이다.

D1 장애는 forward-fix 또는 R2 export→scratch D1 복원→행수/해시/id고수위/outbox 재생 검증으로 대응한다. 운영 D1을 덮어쓰지 않는다. 필요하면G1이전코드 복귀를 별도 검토하지만 자동PG복귀/무손실을 보장하지 않는다. PG에 남은 데이터는 D 전환 이후 갱신되지 않았다.

## 상태·보안

capability는 state-dir/interval-capability.json `{ "v":1,"readStore":"d1","bucketRoute":true }`,0600이다. 180초 불허/손상 시 안전하게 실패한다. provider429는해당override를900으로실제반영하고, D1쓰기/인증/오래된outbox는전체900복귀또는수집정지후보고한다. PM2는 기존env를병합하므로키를파일에서지운것만으로운영env삭제를단정하지않는다.

알림이 Discord에 없어도 안전한 `[zzik collector] reason=`을 확인한다. 비밀값/원문/Location전문을 출력하지 않는다. 격리해제는 collector정지·quiesce완료·마지막원격in-flight종료확인후에만 가능하다. 디스크여유를 먼저 확인하고, 중단된백필spool은 자기경로만 수동정리한다. 상태/게이트/토큰파일을초기화하지않는다.

G2(DB_URL secret삭제·Neon삭제)는 이번범위에서 금지한다. export성공/보존상태 확인과 비가역삭제는 별도작업이다.
