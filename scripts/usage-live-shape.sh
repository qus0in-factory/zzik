#!/usr/bin/env bash
# PostgreSQL에 저장된 실제 수집 응답(rawText)의 "모양"만 출력한다.
# 문자열 값은 길이만, 숫자는 그대로(사용률·리셋 시각 비교용), 라벨류(display_name·kind·group)는 원문.
# 표시 기능을 만들기 전·배포 후에 픽스처 가정과 실데이터가 맞는지 대조하는 용도.
# 사용: scripts/usage-live-shape.sh [claude|codex|antigravity|opencode|grok|ollama]   (기본 claude)
set -euo pipefail
cd "$(dirname "$0")/.."

provider="${1:-claude}"
node --env-file=.env scripts/usage-live-shape-fetch.mjs "$provider" \
  | jq '{status, httpStatus, fetchedAt, rawOmitted, raw: (.rawText // "null" | fromjson)}' \
  | jq 'walk(
      if type == "object" then with_entries(
        if (.key | test("^(kind|group|display_name|severity|id|bucketId|displayName|window|type|product|status)$")) then .
        elif (.value | type) == "string" then .value = "<str:\(.value | length)>"
        else . end)
      else . end)'
