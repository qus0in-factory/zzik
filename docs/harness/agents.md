# 에이전트 구성 및 모델 라벨

이 문서는 자주 바뀌는 에이전트 구성·모델·역할·라벨 매핑의 현재 정본이다. 절차는 `herdr-orchestration`, `herdr-label-models` 스킬을 따른다.

## 에이전트 풀

이 표는 **띄울 수 있는 후보 풀**이다. 어떤 패널이 지금 열려 있는지는 문서에 적지 않고 `herdr agent list`로 확인한다. 패널을 열고 닫을 때마다 이 문서를 고치지 않으며, 새 도구·모델 조합이 처음 생기거나 역할이 바뀔 때만 행을 추가·수정한다.

| 에이전트 | 잘 맞는 일 | 도구·모델 |
|---|---|---|
| `z-opus` | 사용자 응대·총괄·병합·릴리스. 조사·구현·편집·대기를 직접 해도 된다. 항상 연다. | Claude Code (Opus) |
| `z-sol` | 백엔드·수집기 구현, DB 연동, 까다로운 디버깅·조사 | Codex (`GPT-6.2-Sol`, high, Fast) |
| `z-astra` | 구현·조사·검증·리뷰. 손이 가는 일은 `.codex/agents` Terra 서브에이전트에 위임. 결과는 `/tmp/astra-<주제>.md` | Codex (`GPT-6-Astra`, high, Fast) |
| `z-fable` | 구현·조사·검증·설계·리뷰. 손이 가는 일은 `.claude/agents/` Sonnet 서브에이전트에 위임. 결과는 `/tmp/fable-<주제>.md` | Claude Code (`Fable 5.1`, high) |
| `z-sonnet` | UI·일반 구현, 테스트 보강 | Antigravity CLI (`Claude Sonnet 5.5`, high) |
| `z-argon` | 중간 규모 구현·조사 | Antigravity CLI (`Gemini 4 Argon`, high) |
| `z-hyd` | 문서·하네스 동기화, 범위가 명확한 소규모 구현 | Antigravity CLI (`Gemini 4 Hydrogen`, medium) |
| `z-glm` | 이슈 구현 여부 판정, 문서·위키 동기화, 읽기 전용 조사 | OpenCode (OpenCode Go `GLM-5.3`, high) |
| `z-ds` | 경량 구현·잡무, 스크립트·문서 동기화 | OpenCode (Ollama Cloud `DeepSeek V4.1 Flash`, high) |
| `z-hf` | 소규모 구현·문서 동기화·가벼운 확인 | OpenCode (OpenCode Go `Hy4 flash Free`) |
| `z-beam` | 가벼운 확인·잡무 | OpenCode (OpenCode Go `Beam Free`, 기본 모델) |
| `z-grok` | 한도가 남을 때만. 소진되면 다른 워커가 승계 | Grok |

- 배정은 열려 있는 패널 중에서 위 "잘 맞는 일"을 참고해 고른다. 역할은 고정이 아니라 기본값이며, 비어 있는 워커에 다른 성격의 일을 줘도 된다.
- 같은 도구에서 공급자(OpenCode Go·Ollama Cloud)나 모델만 바꿔 다시 열어도 이름은 그대로 쓰고, 이 표는 실제 조합이 자리 잡았을 때 한 번만 고친다.
- OpenCode는 실행 인자로 모델을 받지 않는다(`-m` 전달 시 시작 타임아웃). 기본 모델로 띄운 뒤 `/models`에서 검색해 고르고(공급자 열 확인, 수준 선택 창이 뜨면 고름) 상태줄(`GLM-5.3 OpenCode Go · high`)을 확인한 다음 지시한다. TUI 문자 입력은 `herdr pane send-text`, 키는 `herdr agent send-keys <이름> Enter|Down|Backspace`.
- Antigravity CLI는 `herdr agent start <이름> --kind agy --pane <ID> -- --model <ID>`로 연다. 모델 ID는 `agy models`.

## 사용량 한도·effort (2026-11-17 사용자 지시)

- opus는 작업 성격에 맞춰 워커 effort를 조절할 수 있다(2026-11-17 사용자 허용). fast·모델 변경은 사용자에게 맡긴다. Codex 계열은 현재 Fast를 쓴다. `z-sol`·`z-astra`는 손이 가는 일(탐색·테스트·측정·배포 확인)을 `.codex/agents`의 GPT-6.1 Terra 서브에이전트에 위임하고 판단·설계·통합·최종 검토를 맡는다(2026-11-17 사용자 지시).
- `z-fable`은 같은 철학으로 `.claude/agents/`의 Sonnet 전용 서브에이전트(`explorer` 탐색, `test-runner` 검증 실행, `ui-checker` 화면 넘침 점검, `ops-probe` 운영 읽기 전용 확인, `doc-sync` 문서·띄어쓰기 동기화)에 손이 가는 일을 위임하고 판단·설계·최종 검토를 맡는다. 범위·금지사항은 각 파일 frontmatter와 본문이 정본이며 general-purpose는 쓰지 않는다. `work-reviewer`는 제거했고 `worker-watcher`는 총괄의 워커 대기용으로 2026-11-17 복원했다.
- 한도를 의식하지 않고 소진까지 사용하며, 잔량 경고로 배정을 미루지 않는다.
- 작업 크기(5분·최대 15분 조각), 진행 중 워커에 덧붙이기 금지, 워커 대기는 `worker-watcher` 서브에이전트 — 절차는 `.agents/skills/herdr-orchestration` 참조.

## 워크스페이스 라벨

- 워크스페이스별 접두어 라벨(`z-`, `e-`) 규칙을 따른다.
- 상주 구성은 정하지 않는다. 사용자가 요청하거나 일이 몰릴 때 풀에서 열고, 쓰지 않으면 닫는다.

## 모델 약칭 및 감지 매핑

- `agent` 필드 1차 판정: `codex`→`sol`, `grok`→`grok`.
- 하단 상태줄(비어 있지 않은 마지막 5줄) 판정:
  - `agy`: `Gemini <버전> Hydrogen` 또는 `Hydrogen`→`hydro`, 그 외 `Gemini <버전>`→`gemini`.
  - `opencode`: `GPT-<버전>-Sol`→`sol`, `DeepSeek <버전>`→`ds`, `Hy<버전>`→`hy`, `Hy4 flash`→`hf`(`hy`와 구분), `GLM-<버전>`→`glm`, `Beam Free`→`beam`.
  - `claude`: `Opus|Fable|Sonnet <버전>`→`opus`|`fable`|`sonnet`(마지막 줄 우선).

- 2026-11-17 사용자 지시: z-fable·z-astra는 설계·리뷰 전용이 아니라 구현·조사·검증 등 다양한 일을 맡고 놀리지 않는다. 손이 가는 일은 각자 서브에이전트(fable은 Sonnet 전용 `.claude/agents/`, astra는 Codex Terra `.codex/agents`)에 맡기고 판단·지시·결과 검토만 직접 한다.
