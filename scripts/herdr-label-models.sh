#!/usr/bin/env bash
# 현재 Herdr 워크스페이스의 각 에이전트 패널 화면에서 모델을 감지해
# 탭 라벨 / 패널 라벨 / 에이전트 이름을 모델 약칭으로 지정한다.
# 사용: scripts/herdr-label-models.sh [workspace_id]
set -euo pipefail

test "${HERDR_ENV:-}" = 1 || { echo "Herdr 패널 안에서 실행해야 합니다." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

ws="${1:-$HERDR_WORKSPACE_ID}"

# 화면 텍스트 → 약칭 (화면 하단 상태줄 우선 역순 검색)
detect() {
  local text="$1"
  local line
  # 모델명이 박힌 고유 문자열(상태줄·배너)을 화면 하단부터 위로 거슬러 올라가며 감지한다.
  # 이전 대화의 모델 언급이나 과거 '/model' 전환 기록(예: Fable→Sonnet)에 속지 않게 마지막 상태줄을 우선한다.
  while IFS= read -r line; do
    case "$line" in
      *Grok\ [0-9]*|*[Gg]rok-[0-9]*)            echo grok; return 0 ;;
      *GPT-*-Sol*|*gpt-*-sol*|*-Sol*|*-sol*)   echo sol; return 0 ;;
      *Gemini\ [0-9]*|*[Gg]emini-[0-9]*)       echo gemini; return 0 ;;
      *GLM*|*glm*)                             echo glm; return 0 ;;
      *DeepSeek*|*deepseek*)                   echo ds; return 0 ;;
      *Claude*[Ss]onnet*|*Sonnet*|*sonnet*)    echo sonnet; return 0 ;;
      *Fable*|*fable*)                         echo fable; return 0 ;;
      *Opus*|*opus*)                           echo opus; return 0 ;;
    esac
  done < <(printf '%s\n' "$text" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
  echo ""
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
      target="$name"
      suffix=2
      rename_ok=false
      while :; do
        if err="$(herdr agent rename "$pane" "$target" 2>&1)"; then
          rename_ok=true
          break
        fi
        case "$err" in
          *agent_name_taken*)
            if [ "$suffix" -gt 20 ]; then
              echo "$pane: 에이전트 이름 '$name' 재시도 한도 초과"
              break
            fi
            target="${name}${suffix}"
            suffix=$((suffix + 1))
            ;;
          *)
            echo "$pane: 에이전트 이름 '$target' 지정 실패 ($err)"
            break
            ;;
        esac
      done

      if [ "$rename_ok" != true ]; then
        continue
      fi

      herdr tab rename "$tab" "$target" >/dev/null
      herdr pane rename "$pane" "$target" >/dev/null
      echo "$pane ($tab) → $target"
    done
