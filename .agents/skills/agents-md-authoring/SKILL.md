---
name: agents-md-authoring
description: AGENTS.md(룰)나 .agents/skills(스킬)를 추가·수정할 때 사용. AGENTS.md는 매 세션 토큰에 포함되므로 최소화하고 상세 내용은 필요할 때만 로드되는 스킬로 분리하는 방법.
---

# AGENTS.md / 스킬 작성 원칙

## 무엇을 어디에
- `AGENTS.md`: 항상 지켜야 하는 규칙의 한 줄 요약 + 담당 스킬 이름만. 주제당 1줄, 전체 수 줄 이내.
- `.agents/skills/<name>/SKILL.md`: 절차, 명령어, 예시, 실패 처리, 세부 규칙. 필요할 때만 로드된다.
- 스크립트는 `scripts/`에 두고 스킬에서 참조한다.

## 새 규칙 추가 절차
1. 상세 내용을 스킬로 작성(없으면 `.agents/skills/<kebab-name>/SKILL.md` 생성).
2. frontmatter `description`에 언제 써야 하는지(트리거 문구)를 구체적으로 적는다 — 스킬 선택은 이 한 줄로 결정된다.
3. `AGENTS.md`에는 "<규칙 요지>. <상황> 시 `<skill>` 스킬." 형태로 한 줄만 추가.
4. 기존 줄과 겹치면 새 줄을 만들지 말고 합친다.

## 금지
- AGENTS.md에 코드 블록, 명령어 목록, 예시, 설명 문단을 넣지 않는다.
- 스킬과 AGENTS.md에 같은 내용을 중복해 적지 않는다(AGENTS.md는 포인터만).
