---
name: zzik-deploy
description: zzik 배포·Access 검증·수집기 운영 반영 시 사용. Worker 먼저 배포하고 수집기를 반영한다.
---
# zzik 배포

저장소·배포 현재 상태, 정본 문서, 미사용 보존 대상은 `docs/harness/operations.md` 참고. 비밀값·이메일·계정 ID·토큰·Location 전문·원문을 출력하지 않고 명령 출력은 캡처 후 안전한 Boolean/개수/버전 ID만 보인다.

1. dev에서 릴리스 PR 전 `pnpm screenshot:readme`. 고정 normal fixture는 레이아웃 검증용이며 실데이터/인증 증거가 아님을 명시한다.
2. main 병합 후 release에서 pull→`pnpm install --frozen-lockfile`→clean 확인. 설정된 계정 일치를 안전 출력으로 확인한다. workers_dev:false/preview_urls:false·Access 정책을 유지한다.
3. 코드 게이트 `pnpm exec vitest run --fileParallelism false --maxWorkers 1`, typecheck, typecheck:collector, build. deploy-verify의 로컬 통합 검증은 원격 API 검증 대체가 아니다.
4. **Worker 먼저** release `pnpm run deploy`. 성공/version ID만 출력. `scripts/deploy-verify.mjs` 기본 검증/명시 --deploy 절차를 쓸 수 있다.
5. 쿠키 없는 /, /api/usage, 현재 provider 경로(`docs/harness/operations.md` 참고) 및 bucket 302·Location cdn-cgi/access/login·본문 앱 데이터 없음을 확인한다. `verify-zzik.sh` 출력은 PASS/FAIL/status만 추린다(workers.dev 404/Access 302/DNS 미해석 허용). 인증 우회 패치/정책 추가 금지.
6. 실제 저장소 snapshot fetched_at와 collector ack·이력 id 문자열·보존 기간 bucket(`docs/harness/operations.md` 참고)을 검증한다. usage-live-shape.sh는 원격 저장소를 읽고 원문은 마스킹 파이프 밖에 저장하지 않는다. 인증된 운영 화면은 사용자가 확인하며 미검증 항목을 보고한다.
7. **수집기 다음**, 승인된 범위에서 release의 기본 ecosystem restart --update-env→save. 상세는 zzik-usage-collector. failure 시 수집기 반영 전에 멈추고 보고한다.

실데이터 화면을 위한 인증 우회는 작업/release 파일에 넣지 않는다. 필요하면 별도 /tmp 워크트리에서만 사용하고 삭제한다. 원격 리소스/secret 삭제는 별도 승인이다. 저장소 장애 대응·폴백 여부는 `docs/harness/operations.md` 참고.

- 릴리스 준비는 `scripts/release-prep.mjs`(로컬은 screenshot·KST test·한글 띄어쓰기 검사, UTC test·typecheck·typecheck:collector·build는 CI), 문서 검사는 `scripts/check-hangul-spacing.mjs`, 확인/완료 본문은 `scripts/verify-request.mjs`(`--done`)로 만든다.
