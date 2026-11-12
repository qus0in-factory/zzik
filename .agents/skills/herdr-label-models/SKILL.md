---
name: herdr-label-models
description: Herdr 워크스페이스의 각 에이전트 패널에서 실행 중인 모델(opus, glm, ds, fable, sol 등)을 감지해 탭 라벨·패널 라벨·에이전트 이름을 모델 약칭으로 붙인다. 사용자가 "패널/탭에 모델 이름 붙여", "라벨 정리", "모델별로 이름 지정"을 요청할 때 사용.
---

# Herdr 모델 라벨링

## 전제
- `HERDR_ENV=1` (Herdr 패널 안에서 실행), `jq` 설치.

## 실행
```bash
SELF_LABEL=<내 모델 약칭> scripts/herdr-label-models.sh [workspace_id]
```
- `SELF_LABEL`: 스크립트를 실행하는 자기 패널의 약칭(예: Opus면 `opus`). 자기 화면에는 다른 모델명이 섞여 오판할 수 있으므로 항상 지정한다.
- workspace_id 생략 시 `$HERDR_WORKSPACE_ID`.

## 동작
1. 에이전트가 있는 패널만 골라 `herdr pane read --source visible`로 화면을 읽는다.
2. 화면 글자로 약칭 판별: GLM→`glm`, DeepSeek→`ds`, Fable→`fable`, Opus→`opus`, Sonnet→`sonnet`, `GPT-*-Sol`·`-Sol`→`sol`, `Gemini <버전>`→`gemini`. 고유 문자열(상태줄·배너)을 먼저 매칭해 대화 본문 속 모델명 언급으로 오판하지 않는다.
3. `herdr tab rename`, `herdr pane rename`, `herdr agent rename`으로 세 곳 모두 지정.

## 결과 확인
```bash
herdr tab list --workspace "$HERDR_WORKSPACE_ID" | grep -o '"label":"[^"]*"'
herdr agent list | grep -o '"name":"[^"]*"'
```

## 실패 처리
- "모델 감지 실패, 건너뜀": 모델명이 화면 밖으로 밀림. 해당 패널을 `herdr pane read <pane> --source recent-unwrapped --lines 200`으로 직접 확인 후 수동으로 rename.
- 에이전트 이름 지정 실패: 같은 모델이 둘 이상(이름 중복 불가). `glm2`처럼 구분해 `herdr agent rename <pane> <name>`.
- 새 모델: 스크립트 `detect()`의 `case`에 패턴 한 줄 추가.

## 운영 규칙
- 탭·패널·에이전트 이름은 모델 약칭으로 통일한다: `opus`, `glm`, `ds`, `fable`, `sol`.
- 수동 rename 대신 스크립트로 수행하고, `SELF_LABEL`을 반드시 지정한다.
- 다른 에이전트에 작업을 보낼 때는 pane ID 대신 약칭을 쓴다: `herdr agent prompt glm "..." --wait`.
- `/model` 변경이나 에이전트 재시작 후에는 스크립트를 다시 실행한다.
- 같은 모델이 둘 이상이면 `glm2`처럼 숫자를 붙인다.
