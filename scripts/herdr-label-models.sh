#!/usr/bin/env bash
# 현재 Herdr 워크스페이스에서 이름이 없는 에이전트 패널의 모델을 감지해
# 탭 라벨 / 패널 라벨 / 에이전트 이름을 모델 약칭으로 지정한다.
# 사용: scripts/herdr-label-models.sh [--force] [--dry-run] [workspace_id]
#   --force    이미 이름이 있는 에이전트도 다시 감지한다(기본은 건너뜀)
#   --dry-run  감지 결과만 출력하고 이름을 바꾸지 않는다
set -euo pipefail

test "${HERDR_ENV:-}" = 1 || { echo "Herdr 패널 안에서 실행해야 합니다." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

force=false
dry_run=false
ws=""
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    --dry-run) dry_run=true ;;
    -*) echo "알 수 없는 옵션: $arg" >&2; exit 64 ;;
    *) ws="$arg" ;;
  esac
done
ws="${ws:-$HERDR_WORKSPACE_ID}"

# 화면 맨 아래 상태줄 영역(비어 있지 않은 마지막 5줄)만 돌려준다. 본문 인용문에 속지 않기 위함이다.
bottom_lines() {
  printf '%s\n' "$1" | awk 'NF {a[++n]=$0} END {for (i=(n>5?n-4:1); i<=n; i++) print a[i]}'
}

# herdr agent list의 agent 필드로 1차 판정하고, 모호한 종류만 화면 하단 상태줄로 확인한다.
#   codex → sol, agy → gemini
#   opencode → 하단에 `Grok <버전>` 이면 grok, `GPT-<버전>-Sol` 이면 sol
#   claude → 하단에 `Opus|Fable|Sonnet <버전>` 이 있을 때만(마지막 매칭 우선)
# 판정 실패는 빈 문자열(호출부가 건너뜀).
detect() {
  local agent="$1" screen="$2"
  local ver='[0-9][0-9.]*'
  local bottom line
  case "$agent" in
    codex) echo sol; return 0 ;;
    agy) echo gemini; return 0 ;;
  esac
  bottom="$(bottom_lines "$screen")"
  while IFS= read -r line; do
    case "$agent" in
      opencode)
        if   [[ "$line" =~ Grok\ $ver ]]; then echo grok; return 0
        elif [[ "$line" =~ GPT-$ver-Sol ]]; then echo sol; return 0
        fi ;;
      claude)
        if   [[ "$line" =~ Opus\ $ver ]]; then echo opus; return 0
        elif [[ "$line" =~ Fable\ $ver ]]; then echo fable; return 0
        elif [[ "$line" =~ Sonnet\ $ver ]]; then echo sonnet; return 0
        fi ;;
    esac
  done < <(printf '%s\n' "$bottom" | awk '{a[NR]=$0} END {for (i=NR; i>=1; i--) print a[i]}')
  echo ""
}

# 지정 이름이 이미 있으면 숫자를 붙여 최대 20회 재시도한다. 성공하면 최종 이름을 출력한다.
rename_agent() {
  local pane="$1" name="$2" target="$2" suffix=2 err
  while :; do
    if err="$(herdr agent rename "$pane" "$target" 2>&1)"; then
      echo "$target"
      return 0
    fi
    case "$err" in
      *agent_name_taken*)
        if [ "$suffix" -gt 20 ]; then
          echo "$pane: 에이전트 이름 '$name' 재시도 한도 초과" >&2
          return 1
        fi
        target="${name}${suffix}"
        suffix=$((suffix + 1))
        ;;
      *)
        echo "$pane: 에이전트 이름 '$target' 지정 실패 ($err)" >&2
        return 1
        ;;
    esac
  done
}

# 라이브러리처럼 불러올 때(테스트)는 아래 실행부를 건너뛴다.
if [ "${HERDR_LABEL_SOURCE_ONLY:-}" = 1 ]; then return 0 2>/dev/null || exit 0; fi

while IFS=$'\t' read -r pane tab agent current; do
  if [ -n "$current" ] && [ "$force" != true ]; then
    echo "$pane: 이미 이름 있음($current), 건너뜀"
    continue
  fi
  # 이 스크립트를 실행 중인 패널은 하단 상태줄에 모델 표시가 없을 수 있으므로 SELF_LABEL로 지정한다.
  if [ "$pane" = "${HERDR_PANE_ID:-}" ] && [ -n "${SELF_LABEL:-}" ]; then
    name="$SELF_LABEL"
  else
    name="$(detect "$agent" "$(herdr pane read "$pane" --source visible 2>/dev/null || true)")"
  fi
  if [ -z "$name" ]; then
    echo "$pane ($agent): 모델 감지 실패, 건너뜀"
    continue
  fi
  if [ "$dry_run" = true ]; then
    echo "$pane ($agent): [dry-run] → $name"
    continue
  fi
  if ! target="$(rename_agent "$pane" "$name")"; then
    continue
  fi
  # tab/pane 라벨 실패가 나머지 패널 처리를 끊지 않게 한다.
  herdr tab rename "$tab" "$target" >/dev/null 2>&1 || echo "$pane: 탭 라벨 지정 실패(건너뜀)" >&2
  herdr pane rename "$pane" "$target" >/dev/null 2>&1 || echo "$pane: 패널 라벨 지정 실패(건너뜀)" >&2
  echo "$pane ($tab) → $target"
done < <(herdr agent list 2>/dev/null | jq -r --arg ws "$ws" '.result.agents[] | select(.workspace_id == $ws) | [.pane_id, .tab_id, .agent, (.name // "")] | @tsv')
