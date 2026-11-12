#!/usr/bin/env bash
# 현재 Herdr 워크스페이스의 각 에이전트 패널 화면에서 모델을 감지해
# 탭 라벨 / 패널 라벨 / 에이전트 이름을 모델 약칭으로 지정한다.
# 사용: scripts/herdr-label-models.sh [workspace_id]
set -euo pipefail

test "${HERDR_ENV:-}" = 1 || { echo "Herdr 패널 안에서 실행해야 합니다." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

ws="${1:-$HERDR_WORKSPACE_ID}"

# 화면 텍스트 → 약칭 (위에서부터 먼저 매칭되는 것 사용)
detect() {
  local text="$1"
  # 모델명이 박힌 고유 문자열(상태줄·배너)을 먼저 본다. 대화 본문의 모델 이름 언급으로 오판하지 않게.
  case "$text" in
    *GPT-*-Sol*|*gpt-*-sol*) echo sol ;;
    *Gemini\ [0-9]*)          echo gemini ;;
    *GLM*|*glm*)            echo glm ;;
    *DeepSeek*|*deepseek*)  echo ds ;;
    *Fable*)                echo fable ;;
    *Opus*)                 echo opus ;;
    *Sonnet*)               echo sonnet ;;
    *-Sol*|*-sol*)          echo sol ;;
    *)                      echo "" ;;
  esac
}

herdr pane list --workspace "$ws" \
  | jq -r '.result.panes[] | select(.agent != null) | "\(.pane_id) \(.tab_id)"' \
  | while read -r pane tab; do
      # 이 스크립트를 실행 중인 패널은 화면에 모델명이 안 보일 수 있으므로 환경변수로 지정 가능
      if [ "$pane" = "${HERDR_PANE_ID:-}" ] && [ -n "${SELF_LABEL:-}" ]; then
        name="$SELF_LABEL"
      else
        name="$(detect "$(herdr pane read "$pane" --source visible)")"
      fi
      if [ -z "$name" ]; then
        echo "$pane: 모델 감지 실패, 건너뜀"
        continue
      fi
      herdr tab rename "$tab" "$name" >/dev/null
      herdr pane rename "$pane" "$name" >/dev/null
      herdr agent rename "$pane" "$name" >/dev/null || echo "$pane: 에이전트 이름 '$name' 지정 실패(중복?)"
      echo "$pane ($tab) → $name"
    done
