#!/usr/bin/env bash
# .env 의 DISCORD_WEBHOOK_URL 로 완료 보고를 보낸다.
# 사용: scripts/notify-discord.sh "<제목>" "<본문>" [--dry-run]
#       본문을 - 로 주면 stdin에서 읽는다.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
title="${1:?제목 필요}"; body="${2:-}"; dry="${3:-}"
[ "$body" = "-" ] && body="$(cat)"

url="${DISCORD_WEBHOOK_URL:-}"
if [ -z "$url" ] && [ -f "$root/.env" ]; then
  url="$(grep -E '^DISCORD_WEBHOOK_URL=' "$root/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
[ -n "$url" ] || { echo "DISCORD_WEBHOOK_URL 없음(.env 확인)" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

# embed description 최대 4096자
payload="$(jq -n --arg t "$title" --arg d "${body:0:4000}" \
  '{username:"zzik opus", embeds:[{title:$t, description:$d, color:5763719}]}')"

if [ "$dry" = "--dry-run" ]; then echo "$payload"; exit 0; fi
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$payload" "$url")"
[ "$code" = 204 ] || [ "$code" = 200 ] || { echo "전송 실패: HTTP $code" >&2; exit 1; }
echo "전송 완료"
