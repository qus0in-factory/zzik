# sol의 프로젝트 서브에이전트

Codex CLI 0.167.2에서 확인했다. `.codex/agents/*.toml`의 `name`, `description`, `developer_instructions`가 독립 역할을 등록한다. 같은 이름의 기본 역할보다 프로젝트 정의가 우선하며 새 세션에서 읽는다.

| 이름 | 위임 범위 |
|---|---|
| explorer | 읽기 전용 코드 탐색·영향 범위 |
| test-runner | test·typecheck·typecheck:collector·build, 소스 수정 없음 |
| db-probe | 작업별 사용자 승인 후 운영 SELECT·EXPLAIN 측정만 |
| deploy-checker | 302/404·workerd 검증, 배포/재시작 없음 |

모두 `model = "gpt-6.1-terra"`, effort medium. `codex debug models --bundled`에서 Terra의 Fast 티어 ID는 `priority`다. [설정 참조](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)에 따라 프로젝트 `config.toml`에 `service_tier = "fast"`를 둔다(`priority`로 전송).

[공식 서브에이전트 문서](https://learn.chatgpt.com/docs/agent-configuration/subagents)에 따라 **서비스 티어·샌드박스·승인·provider·MCP는 부모 세션을 상속한다**. 역할 파일에 sandbox_mode/service_tier를 넣어 별도 강제한 것처럼 만들지 않는다. explorer의 읽기 전용 등 역할 제약은 개발자 지침이며 독립 보안 샌드박스는 아니다. 부모는 업무별 권한과 승인 범위를 먼저 확정하고 필요한 최소 권한으로 시작한다. 이 설정은 부모 모델을 바꾸지 않는다.

호출 예: “현재 워크트리를 프로젝트 `test-runner` 서브에이전트에 위임해 네 검증 명령의 결과만 요약해.” sol은 구현·통합을 담당하고 탐색·검증·측정은 해당 역할에 맡긴다. 검증은 실제 DB/웹훅 환경변수를 제거하며, 실제 운영 DB 게이트는 db-probe/deploy-checker에 별도 승인 범위를 전달한다. 운영 쓰기·agy·장기 서버 실행·남의 프로세스 종료는 모든 역할에서 금지한다.

현재 sol의 `collaboration.spawn_agent` 도구는 `agent_type` 대신 `task_name`·`model`·`reasoning_effort`·`fork_turns`를 받는다. 이 인터페이스에서는 이름만으로 자동 선택됐다고 가정하지 않는다. 부모가 위임할 역할 TOML을 읽고 모델/effort를 명시한 뒤, 자식에게 같은 파일의 developer_instructions를 읽고 적용하도록 전달한다. 예를 들어 test-runner는 `task_name="test_runner"`, `model="gpt-6.1-terra"`, `reasoning_effort="medium"`, `fork_turns="none"`으로 호출하고 작업 경로와 `.codex/agents/test-runner.toml`을 메시지에 지정한다. 현재 도구의 Fast(priority) 티어를 사용한다. `agent_type`을 지원하는 Codex에서는 프로젝트 이름으로 직접 위임한다.
