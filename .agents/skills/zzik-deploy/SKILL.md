---
name: zzik-deploy
description: zzik D1 단독 배포·Access 검증·수집기 운영 반영 시 사용. Worker 먼저 배포하고 수집기를 반영한다.
---
# D1 단독 배포

ADR0.1 Access, ADR0.10 G1 및 docs/d1-d-cutover.md가정본이다. G1은PG코드제거이며 DB_URL/Neon삭제가아니다. .env/secret의DB_URL은미사용으로보존한다. 비밀값·이메일·계정ID·토큰·Location전문·원문을출력하지않고명령출력은캡처후안전한Boolean/개수/버전ID만보인다.

1. dev에서릴리스PR전 `pnpm screenshot:readme`. 고정normal fixture는레이아웃검증용이며실데이터/인증증거가아님을명시한다.
2. main병합후release에서pull→`pnpm install --frozen-lockfile`→clean확인. ADR계정일치를안전출력으로확인한다. workers_dev:false/preview_urls:false·Access정책을유지한다.
3. 코드게이트 `pnpm exec vitest run --fileParallelism false --maxWorkers 1`, typecheck, typecheck:collector, build. deploy-verify의D1workerd는로컬통합검증이며원격API검증대체가아니다.
4. **Worker먼저** release `pnpm run deploy`. 성공/versionID만출력. `scripts/deploy-verify.mjs` 기본검증/명시--deploy절차를쓸수있다.
5. 쿠키없는/, /api/usage,6provider경로및bucket302·Location cdn-cgi/access/login·본문앱데이터없음을확인한다. verify-zzik.sh qus0in 출력은PASS/FAIL/status만추린다(workers.dev404/Access302/DNS미해석허용). 인증우회패치/정책추가금지.
6. 실제D1snapshot fetched_at와collectorack·이력id문자열·30일bucket을검증한다. usage-live-shape.sh는D1을읽고원문은마스킹파이프밖에저장하지않는다. 인증된운영화면은사용자가확인하며미검증항목을보고한다.
7. **수집기다음**, 승인된범위에서release의기본ecosystem restart --update-env→save. 상세는zzik-usage-collector. failure시수집기반영전에멈추고보고한다.

실데이터화면을위한인증우회는작업/release파일에넣지않는다. 필요하면별도/tmp워크트리에서만사용하고삭제한다. 원격리소스/secret삭제와Neon삭제는별도승인이다. D1장애는수집정지·forward-fix/R2scratch복구로대응하며PG폴백은없다.
