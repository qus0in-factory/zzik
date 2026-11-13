#!/usr/bin/env bash
# 현재 Herdr 워크스페이스의 각 에이전트 패널 화면에서 모델을 감지해
# 탭 라벨 / 패널 라벨 / 에이전트 이름을 모델 약칭으로 지정한다.
# 사용: scripts/herdr-label-models.sh [workspace_id]
set -euo pipefail

test "${HERDR_ENV:-}" = 1 || { echo "Herdr 패널 안에서 실행해야 합니다." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

ws="${1:-$HERDR_WORKSPACE_ID}"

# 화면 텍스트 → 약칭. 배너·상태줄 형태만 매칭한다:
#   `Fable 5.2 with high effort · Claude Max`, `Opus 5.5 (1M context)`, `Build auto · Grok 4.7 xAI · high`, `GPT-6.1-Sol medium`
# 대화 본문에 인용된 "Sonnet 5.5"처럼 버전 뒤에 배너 문맥(with / · / ( / xAI)이 없는 문장, 소문자·버전 없는 단어
# ('sonnet', 'opus', '-sol')는 오탐이라 매칭하지 않는다. 화면 하단부터 위로 검색해 마지막 상태줄을 우선한다.
# 모델 표시가 없으면 빈 문자열을 돌려주고, 호출부가 이름을 바꾸지 않고 건너뛴다.
detect() {
  local text="$1"
  local line
  local ver='[0-9][0-9.]*'
  local ctx='( with | ·| \()'
  while IFS= read -r line; do
    if   [[ "$line" =~ Grok\ $ver\ (xAI|·) ]]; then echo grok; return 0
    elif [[ "$line" =~ GPT-$ver-Sol ]]; then echo sol; return 0
    elif [[ "$line" =~ Gemini\ $ver ]]; then echo gemini; return 0
    elif [[ "$line" =~ GLM-?\ ?$ver ]]; then echo glm; return 0
    elif [[ "$line" =~ DeepSeek-?\ ?[Vv]?$ver ]]; then echo ds; return 0
    elif [[ "$line" =~ Sonnet\ $ver$ctx ]]; then echo sonnet; return 0
    elif [[ "$line" =~ Fable\ $ver$ctx ]]; then echo fable; return 0
    elif [[ "$line" =~ Opus\ $ver$ctx ]]; then echo opus; return 0
    fi
  done < <(printf '%s\n' "$text" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
  echo ""
}

herdr pane list --workspace "$ws" \
  | jq -r '.result.panes[] | select(.agent != null) | "\(.pane_id) \(.tab_id)"' \
  | while read -r pane tab; do
      # 이 스크립트를 실행 중인 패널은 화면에 버전 붙은 모델 표시가 없을 수 있으므로 SELF_LABEL로 지정한다.
      # 모델 표시가 없는 그 밖의 패널은 감지 실패로 건너뛴다(이름을 바꾸지 않는다).
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
