#!/usr/bin/env bash
# .env 의 DISCORD_WEBHOOK_URL 로 완료 보고를 보낸다.
# 사용: scripts/notify-discord.sh "<제목>" "<본문>" [--image <경로>]... [--dry-run]
#       본문을 - 로 주면 stdin에서 읽는다.
#       --image 는 여러 번 지정할 수 있고 최대 4장이다.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
title=""; body=""; have_body=0; dry=false
images=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=true; shift ;;
    --image)
      [ -n "${2:-}" ] || { echo "--image 다음에 경로가 필요합니다." >&2; exit 64; }
      images+=("$2"); shift 2 ;;
    --image=*)
      images+=("${1#--image=}"); shift ;;
    -)
      if [ "$have_body" = 0 ]; then body="$(cat)"; have_body=1; else echo "인자가 너무 많습니다." >&2; exit 64; fi
      shift ;;
    -*) echo "알 수 없는 옵션: $1" >&2; exit 64 ;;
    *)
      if [ -z "$title" ]; then title="$1"
      elif [ "$have_body" = 0 ]; then body="$1"; have_body=1
      else echo "인자가 너무 많습니다." >&2; exit 64
      fi
      shift ;;
  esac
done

[ -n "$title" ] || { echo "제목 필요" >&2; exit 1; }
[ "${#images[@]}" -le 4 ] || { echo "이미지는 최대 4장까지 첨부할 수 있습니다." >&2; exit 64; }

# 첨부 파일명은 attachment:// 참조에 쓰이므로 basename 기준으로 유일하게 만든다.
names=()
if [ "${#images[@]}" -gt 0 ]; then
  for img in "${images[@]}"; do
    [ -f "$img" ] || { echo "이미지 파일 없음: $img" >&2; exit 66; }
    name="$(basename "$img")"; n=2
    while [[ " ${names[*]:-} " == *" $name "* ]]; do name="$n-$(basename "$img")"; n=$((n + 1)); done
    names+=("$name")
  done
fi

url="${DISCORD_WEBHOOK_URL:-}"
if [ -z "$url" ] && [ -f "$root/.env" ]; then
  url="$(grep -E '^DISCORD_WEBHOOK_URL=' "$root/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
[ -n "$url" ] || { echo "DISCORD_WEBHOOK_URL 없음(.env 확인)" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

# embed description 최대 4096자. 이미지가 있으면 embed image가 attachment://파일명을 참조한다.
# username은 지정하지 않는다 — 웹훅 자체 이름(피짱)이 그대로 쓰인다.
payload="$(jq -n --arg t "$title" --arg d "${body:0:4000}" \
  '{embeds:[{title:$t, description:$d, color:5763719}]}')"
for name in "${names[@]:-}"; do
  [ -n "$name" ] || continue
  payload="$(jq --arg url "attachment://$name" '
    if (.embeds[0] | has("image")) then .embeds += [{image:{url:$url}}]
    else .embeds[0].image = {url:$url} end' <<<"$payload")"
done

if [ "$dry" = true ]; then
  echo "$payload"
  for i in "${!names[@]}"; do printf 'files[%d]=%s\n' "$i" "${names[$i]}"; done
  exit 0
fi

if [ "${#images[@]}" -eq 0 ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$payload" "$url")"
else
  args=(-s -o /dev/null -w '%{http_code}' --form-string "payload_json=$payload")
  for i in "${!images[@]}"; do args+=(-F "files[$i]=@${images[$i]};filename=${names[$i]}"); done
  code="$(curl "${args[@]}" "$url")"
fi
[ "$code" = 204 ] || [ "$code" = 200 ] || { echo "전송 실패: HTTP $code" >&2; exit 1; }
echo "전송 완료"
