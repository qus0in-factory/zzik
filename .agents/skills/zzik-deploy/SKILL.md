---
name: zzik-deploy
description: zzik 배포·배포 후 검증을 하거나 배포 뒤 수집기를 재시작할 때 사용. main 병합 후 release 워크트리 배포, pnpm run deploy, 미인증 302(/·/api/usage·/api/usage/:provider), workers.dev 404, DNS 캐시 --resolve, Access 설정 대조 문구에서 트리거.
---

# zzik 배포 · 검증

기준: 호스팅·Access는 `docs/adr/0.1-cloudflare-workers-access.md`, API·수집기는 `docs/adr/0.2-claude-usage.md`·`0.3-chatgpt-usage.md`. 설정값은 ADR 표가 유일한 기준이므로 여기 중복해 적지 않는다.

## 1. 배포 (main 병합 후)
- `dev → main` PR이 **병합된 뒤에만** 배포한다. `dev`나 작업 브랜치에서 직접 배포하지 않는다.
- `.worktree/release`(main 체크아웃)에서 순서대로:
  1. `git pull`
  2. `pnpm install --frozen-lockfile`
  3. `pnpm run deploy` (= `pnpm build && wrangler deploy`)
- 전제: `wrangler whoami`가 계정 `c89ea66c04742e4f6f1feb8dd8e5b775`. Access 앱/정책은 0.1 D4 그대로(대시보드 수동, Bypass·Service Auth 0개).
- `workers_dev: false`, `preview_urls: false`를 되돌리지 않는다. `wrangler versions upload`·`--preview-alias`도 쓰지 않는다.

## 2. 배포 후 검증 (쿠키 없는 미인증 요청)
- `/`, `/api/usage`, `/api/usage/<provider>`(claude·codex)가 모두 302이고 `Location`에 `cdn-cgi/access/login`이 있어야 하며, 본문에 앱 데이터가 없어야 한다.
  ```bash
  for p in / /api/usage /api/usage/claude /api/usage/codex; do
    code=$(curl -s -D /tmp/zzik-hdr -o /tmp/zzik-body -w '%{http_code}' "https://zzik.qus0in.dev$p")
    printf '%s %s\n' "$code" "$p"; grep -i '^location:' /tmp/zzik-hdr
    grep -qE 'Hello Young-In|rawText|used_percent' /tmp/zzik-body && echo "FAIL: 데이터 노출 $p"
  done
  ```
- workers.dev는 404(또는 DNS 미해석·Access 302)여야 한다. `scripts/verify-zzik.sh qus0in`(= `zzik.qus0in.dev` 계열 서브도메인 검사).
- `scripts/verify-zzik.sh`는 `/`만 본다. API 경로는 위 루프로 함께 확인한다.
- 로컬 DNS 캐시가 옛 주소를 물고 있으면 `--resolve`로 엣지를 직접 지정한다:
  ```bash
  ip=$(dig +short zzik.qus0in.dev @1.1.1.1 | head -1)
  curl --resolve "zzik.qus0in.dev:443:$ip" -s -o /dev/null -w '%{http_code}\n' https://zzik.qus0in.dev/api/usage
  ```
- 배포 출력에 `zzik.qus0in.dev` 외 URL이 나오거나 302가 아니면 실패로 보고 설정부터 확인한다.

## 3. 배포 후 수집기
- 수집기 PM2 프로세스는 `.worktree/release` 체크아웃을 cwd로 돈다(브랜치 전환과 무관하게 배포본 기준). 재시작·로그·증상 대응은 `zzik-usage-collector` 스킬을 따른다.
- `/api/usage/:provider` 계약이 바뀐 배포면 재시작 후 KV 봉투의 `provider`·`runAt`을 확인한다.

## 4. 담당
- 배포·검증·수집기 재시작 같은 운영 작업은 **워커 에이전트**가 실행한다. 설계·검수 에이전트는 명령을 대신 돌리지 않고 결과만 확인한다.
