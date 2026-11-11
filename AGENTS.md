# AGENTS.md
- 이 파일은 매 세션 토큰에 포함된다. 한 줄 포인터만 두고 상세 절차는 `.agents/skills/`에 둔다 (작성법: `agents-md-authoring` 스킬).
- Herdr 탭·패널·에이전트 이름은 모델 약칭(opus/glm/ds/fable/sol). 라벨링·에이전트 간 작업 전달 시 `herdr-label-models` 스킬.
- opus가 총괄하며 다른 에이전트(glm/ds/sol/fable)에 작업을 분배·검수한다. fable은 사용량 제한으로 설계 전용. 나머지는 opus 지시만 수행. 분배 시 `herdr-orchestration` 스킬.
- 패키지 매니저는 pnpm. 문서는 `docs/`(ADR은 `docs/adr/<버전>-<slug>.md`). 배포·Access는 `zzik-deploy` 스킬.
- 코드는 `ui/app/domain/infra` 레이어(의존은 ui→app→domain, infra는 app이 주입). TDD/BDD로 `tests/`에 단위 테스트 먼저 작성.
