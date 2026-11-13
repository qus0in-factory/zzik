---
name: herdr-label-models
description: Herdr 워크스페이스의 각 에이전트 패널에서 실행 중인 모델(opus, sol, fable, gemini, grok, sonnet 등)을 감지해 탭 라벨·패널 라벨·에이전트 이름을 모델 약칭으로 붙인다. 사용자가 "패널/탭에 모델 이름 붙여", "라벨 정리", "모델별로 이름 지정"을 요청할 때 사용.
---

# Herdr 모델 라벨링

## 전제
- `HERDR_ENV=1` (Herdr 패널 안에서 실행), `jq` 설치.

## 실행
```bash
SELF_LABEL=<내 모델 약칭> scripts/herdr-label-models.sh [--force] [--dry-run] [workspace_id]
```
- `SELF_LABEL`: 스크립트를 실행하는 자기 패널의 약칭(예: Opus면 `opus`). 자기 화면에는 버전 붙은 모델 표시가 없거나 다른 모델명이 섞일 수 있으므로 항상 지정한다.
- workspace_id 생략 시 `$HERDR_WORKSPACE_ID`.

## 동작
1. `herdr agent list`로 워크스페이스의 에이전트를 읽는다. **이미 이름이 있는 에이전트(`name`≠null)는 건너뛴다.** 이름이 없는 패널만 감지·라벨링하고, `--force`일 때만 이름이 있어도 다시 감지한다. `--dry-run`은 감지 결과만 출력하고 이름을 바꾸지 않는다.
2. `agent` 필드로 1차 판정한다: `codex`→`sol`, `agy`→`gemini`. 모호한 종류만 `herdr pane read --source visible`의 **화면 맨 아래 상태줄 영역(비어 있지 않은 마지막 5줄)** 에서 확인한다.
   - `opencode`: `Grok <버전>`→`grok`, `GPT-<버전>-Sol`→`sol`.
   - `claude`: `Opus|Fable|Sonnet <버전>`→`opus`|`fable`|`sonnet`(마지막 줄 우선).
   - 상태줄에서 확인되지 않으면 이름을 바꾸지 않고 건너뛴다. 본문 인용문(위쪽 줄)은 보지 않는다. 자기 패널은 `SELF_LABEL`을 쓴다.
3. `herdr agent rename` 성공 시 `herdr tab rename`, `herdr pane rename`으로 세 곳을 지정한다. 에이전트 이름 지정이 실패하면 tab/pane 변경과 출력은 생략하고, tab/pane 라벨 실패는 경고만 남기고 다음 패널로 계속한다.

## 결과 확인
```bash
herdr tab list --workspace "$HERDR_WORKSPACE_ID" | grep -o '"label":"[^"]*"'
herdr agent list | grep -o '"name":"[^"]*"'
```

## 실패 처리
- "모델 감지 실패, 건너뜀": 하단 상태줄에 버전 붙은 모델 표시가 없음. 해당 패널을 `herdr pane read <pane> --source recent-unwrapped --lines 200`으로 확인 후 `herdr agent rename`으로 수동 지정한다. 해당 패널을 `herdr pane read <pane> --source recent-unwrapped --lines 200`으로 직접 확인 후 수동으로 rename.
- 에이전트 이름 지정 실패: `agent_name_taken` 에러 시 `gemini2`, `sonnet2`처럼 숫자를 자동으로 붙여 최대 20회까지 재시도한다. 그 외 에러는 tab/pane rename을 생략하고 건너뛴다.
- 새 모델: 스크립트 `detect()`에 `agent` 종류별 분기 또는 하단 상태줄 패턴을 추가한다(소문자·버전 없는 단어 패턴 금지). 테스트: `tests/scripts/herdr-label-models.test.ts`.

## 운영 규칙
- 탭·패널·에이전트 이름은 모델 약칭으로 통일한다: `opus`, `sol`, `fable`, `gemini`, `grok`, `sonnet`.
- 수동 rename 대신 스크립트로 수행하고, `SELF_LABEL`을 반드시 지정한다.
- 다른 에이전트에 작업을 보낼 때는 pane ID 대신 약칭을 쓴다: `herdr agent prompt glm "..." --wait`.
- `/model` 변경이나 에이전트 재시작 후에는 스크립트를 다시 실행한다.
- 같은 모델이 둘 이상이면 `glm2`처럼 숫자를 붙인다.
