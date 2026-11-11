#!/usr/bin/env bash
# zzik 배포 검증 — ADR 0.1 Verification 2·3 자동화.
# 2: 미인증 요청이 zzik.qus0in.dev 에서 302 + cloudflareaccess.com Location 으로
#    차단되고, 응답 본문에 앱 콘텐츠(Hello Young-In)가 없는지 확인한다.
# 3: 인자로 workers.dev 서브도메인을 받으면 그 URL이 앱을 서빙하지 않는지 확인한다.
# 사용: scripts/verify-zzik.sh                            # Verification 2만 실행
#       scripts/verify-zzik.sh <account-subdomain>        # zzik.<sub>.workers.dev 로 확인
#       scripts/verify-zzik.sh zzik.<sub>.workers.dev     # 전체 URL 형태도 허용
set -euo pipefail

APP_URL="https://zzik.qus0in.dev"
APP_TEXT="Hello Young-In"

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1" >&2; exit 1; }

if [ "$#" -gt 1 ]; then
  printf '사용법: %s [workers.dev 서브도메인|URL]\n' "$0" >&2
  exit 2
fi

WORKER_URL=""
if [ "$#" -eq 1 ]; then
  case "$1" in
    https://* | http://*) WORKER_URL="$1" ;;
    *.workers.dev)        WORKER_URL="https://$1" ;;
    *)                    WORKER_URL="https://zzik.$1.workers.dev" ;;
  esac
fi

hdr_file=$(mktemp)
body_file=$(mktemp)
trap 'rm -f "$hdr_file" "$body_file"' EXIT

# fetch <url> → 상태 코드를 stdout 으로, 헤더/본문은 hdr_file, body_file 에 저장.
fetch() {
  curl -s --max-time 30 -D "$hdr_file" -o "$body_file" "$1" \
    || fail "요청 실패: $1 에 연결할 수 없다(아직 배포 전이면 배포 후 다시 실행)"
  head -n1 "$hdr_file" | awk '{print $2}'
}

# ── Verification 2: 미인증 차단 ────────────────────────────────────────────
echo "== Verification 2: 미인증 차단 ($APP_URL)"
status=$(fetch "$APP_URL")
location=$(grep -i '^location:' "$hdr_file" | head -n1 | tr -d '\r' | cut -d' ' -f2-) || location=""

if [ "$status" != "302" ]; then
  fail "상태 코드가 302가 아니다(실제: ${status:-알 수 없음}) — Access 앱이 이 도메인을 가리고 있지 않다"
fi
if [ -n "$location" ]; then
  printf '      Location: %s\n' "$location"
fi
if ! grep -qi 'cloudflareaccess.com' <<<"${location:-}"; then
  fail "Location 에 cloudflareaccess.com 이 없다: '${location:-없음}'"
fi
if grep -qF "$APP_TEXT" "$body_file"; then
  fail "응답 본문에 '$APP_TEXT' 가 보인다 — Access 없이 앱이 공개된 상태다"
fi
pass "미인증 요청이 Access 로그인(302)으로 차단되고 본문에 앱 콘텐츠가 없다"

# ── Verification 3: workers.dev 우회 차단 ──────────────────────────────────
if [ -n "$WORKER_URL" ]; then
  echo "== Verification 3: workers.dev 우회 차단 ($WORKER_URL)"
  status=$(fetch "$WORKER_URL")
  if grep -qF "$APP_TEXT" "$body_file"; then
    fail "$WORKER_URL 이 app을 서빙한다(상태 $status) — workers_dev/preview_urls 를 다시 켜지 말 것"
  fi
  pass "$WORKER_URL 은 앱을 서빙하지 않는다(상태 $status)"
else
  echo "== Verification 3: 서브도메인 인자가 없어 workers.dev 확인은 건너뛴다"
fi

echo "통과: ADR 0.1 Verification 2·3 완료"
