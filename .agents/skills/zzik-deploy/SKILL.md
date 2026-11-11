---
name: zzik-deploy
description: zzik를 Cloudflare Workers에 배포하거나 Cloudflare Access 설정·검증할 때 사용. 배포, Access 앱 생성, wrangler deploy, 배포 검증, workers.dev 우회 확인 문구에서 트리거.
---

# zzik 배포 · Access 절차

기준 문서는 `docs/adr/0.1-cloudflare-workers-access.md`다. 설정값은 ADR의 것이 유일한 기준이며 이 스킬에 중복해 적지 않는다.

## 1. 전제 확인 (구현 착수 전)
- `wrangler whoami`: 계정 `c89ea66c04742e4f6f1feb8dd8e5b775`로 로그인돼 있는지.
- `qus0in.dev` zone이 위 계정에 active 상태로 있는지.
- Zero Trust 조직(team domain `<team>.cloudflareaccess.com`)이 만들어져 있는지. 없으면 대시보드에서 Free 플랜으로 먼저 생성한다.
- `zzik.qus0in.dev`에 기존 DNS 레코드가 없는지. 있으면 custom domain 생성이 충돌한다.

## 2. Access 앱 생성 (배포보다 먼저)
- Zero Trust 대시보드에서 수동 생성한다. wrangler OAuth 토큰에는 Access write 권한이 없으므로 자동화하지 않는다.
- 앱/정책 항목값은 ADR D4 표를 참조해 그대로 설정한다(정책 1개, Bypass·Service Auth 없음). 표를 다시 베끼지 말 것.

## 3. 배포 (Access 이후)
- 순서: Access 앱 먼저 → `pnpm deploy`. Access를 먼저 만들어야 첫 배포부터 보호되고 공개 노출 구간이 생기지 않는다.
- 배포 전 로컬 확인은 `pnpm build` · `pnpm dev`로만 할 수 있다(preview URL이 없음).

## 4. 검증
- 배포 후 `scripts/verify-zzik.sh`를 실행한다(ADR Verification 2·3 자동화). 미인증 요청은 302 + Location 에 `cdn-cgi/access/login` 이 있는 것으로 차단을 판정하고, 본문에 `Hello Young-In` 이 없어야 한다. cloudflareaccess.com 여부는 참고 출력일 뿐이다.
- workers.dev 우회까지 확인하려면 서브도메인을 인자로 넣는다: `scripts/verify-zzik.sh <account-subdomain>`. URL이 200 을 돌려주면 앱 문구가 없어도 경고가 출력된다.
- 나머지 Verification(4~7)은 사람이 수동으로: 시크릿 창 로그인, Access 로그, SPA 폴백, 대시보드 설정 대조.

## 5. 되돌리기 금지
- `wrangler.jsonc`의 `workers_dev: false`, `preview_urls: false`를 다시 켜지 말 것. 켜는 순간 workers.dev/preview URL이 Access 밖으로 공개된다.
- 설정을 바꿨으면(Access 앱 포함) 반드시 `scripts/verify-zzik.sh`를 다시 돌린다.
