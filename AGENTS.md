# AGENTS.md
- 이 파일은 매 세션 토큰에 포함된다. 한 줄 포인터만 두고 상세 절차는 `.agents/skills/`에 둔다 (작성법: `agents-md-authoring` 스킬).
- Herdr 탭·패널·에이전트는 모델 약칭으로 라벨링한다. 라벨링·에이전트 간 작업 전달 시 `herdr-label-models` 스킬.
- 총괄 에이전트가 사용자 응대·총괄·병합·릴리스와 직접 작업을 맡고 워커에 나눈다(위험 변경만 가볍게 리뷰, 비가역은 승인, 비밀값 비노출). 현재 구성은 `docs/harness/agents.md`, 상세 절차는 `herdr-orchestration` 스킬.
- 패키지 매니저는 pnpm. 문서는 `docs/`(ADR은 `docs/adr/<버전>-<slug>.md`). 배포·Access는 `zzik-deploy` 스킬.
- 코드는 `ui/app/domain/infra` 레이어(의존은 ui→app→domain, infra는 app이 주입). TDD/BDD로 `tests/`에 단위 테스트 먼저 작성.
- 브랜치: 작업 브랜치 → 로컬 `dev` 병합 → `dev→main` PR(main 보호). 상세는 `herdr-orchestration` 스킬.
- 사용량 수집기 운영(PM2·장애 대응)은 `zzik-usage-collector` 스킬.
