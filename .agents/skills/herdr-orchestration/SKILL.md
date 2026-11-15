---
name: herdr-orchestration
description: opus가 Herdr 패널의 다른 모델 에이전트(sol, beam, grok, hydro, 필요 시 fable·ds)에 작업을 분배·대기·검수할 때 사용. 역할 배정, 워커 협업·교차 리뷰, 프롬프트 전송 명령, fable 사용 제한 규칙 포함. opus 외 에이전트는 이 스킬로 다른 에이전트를 호출하지 않는다.
---

# Herdr 오케스트레이션 (opus 총괄)

## 역할
| 에이전트 | 역할 | 맡기는 일 |
|---|---|---|
| `opus` | 총괄 | 작업 분해, 분배, 결과 검수·통합, 최종 판단과 사용자 보고 |
| `sol` | 백엔드/수집기 구현·조사·교차 리뷰 (Codex GPT-6.1-Sol) | 설계에 따른 구현, Postgres/DB 연동, 수집기 인프라, 까다로운 디버깅, 외부 API/CLI·동작 원리 조사, 실데이터 검증, 구현자가 아닌 쪽의 교차 리뷰(리뷰 시 high). 탐색·테스트·측정은 sol 내부 보조 서브에이전트(`.codex/agents/` terra) 활용 허용 |
| `beam` | 경량 구현/잡무·배포 실행 (OpenCode, Beam Free) | 소규모 구현, UI 패치 배포 실행, 워크트리 정리, 리뷰 지적 반영. 설계·핵심 경로 구현 제외 |
| `grok` | 구현·교차 리뷰 (Grok Build CLI, Grok 4.7) | 기능 구현, 테스트 보강, 구현자가 아닌 쪽의 교차 리뷰(리뷰 시 high) |
| `hydro` | 경량 구현·문서·하네스 동기화 (Antigravity CLI, Gemini 4 Hydrogen) | 범위가 명확한 소규모 구현, 문서·하네스·스킬 동기화, 테스트 보강, 리뷰 지적 반영. 설계·운영 배포 제외 |
| `fable` | 설계·핵심 경로 리뷰(effort high) — **현재 미배치** | (패널 재오픈 시) 아키텍처·인터페이스·데이터 모델 설계, 설계 리뷰·핵심 경로 리뷰. **구현·검색·테스트·잡무 금지**. 설계는 Herdr fable 패널 또는 fable-designer 서브에이전트(effort high)로 호출 |
| `ds` | 경량 구현/잡무 (OpenCode, DeepSeek V4.1 Flash via Ollama Cloud) — **현재 미배치** | (패널 재오픈 시) 범위가 명확한 소규모 구현, 테스트 보강, 하네스·스크립트·문서 동기화, 리뷰 지적 반영. 설계·운영 배포·대규모 구조 변경 제외 |
| `.claude/agents/` 전용 서브에이전트<br>(`worker-watcher`, `work-reviewer`, `fable-designer`) | 대기·최종 판정·설계 예외 | opus는 구현·리뷰를 Claude Code 서브에이전트(sonnet)에 직접 위임하지 않고 Herdr 워커끼리 협업한다. 예외는 `worker-watcher`(대기·요약), `work-reviewer`(최종 판정), `fable-designer`(설계 예외)이며, 각 워커가 자기 도구 안에서 쓰는 내부 보조 서브에이전트(예: sol의 `.codex/agents/` terra)는 허용 |

## fable 사용 제한 (설계·핵심 리뷰)
- fable은 설계와 핵심 경로 리뷰에만 쓴다. 구현·검색·테스트·잡무는 금지한다.
- 설계 또는 핵심 경로 리뷰가 실제로 필요한 경우에만 호출한다(새 모듈, 구조 변경, 트레이드오프 판단, 핵심 경로 검증). 단순 작업은 절대 보내지 않는다.
- 설계는 Herdr fable 패널 또는 fable-designer 서브에이전트(effort high)로 호출.
- 한 번에 필요한 맥락(목표, 제약, 관련 파일 경로)을 모두 담아 왕복 횟수를 줄인다.
- 결과는 설계안 또는 리뷰 판정만 받는다(/tmp 파일). opus가 `docs/`로 옮긴다.

## 흐름
1. opus가 작업을 분해하고, 설계가 필요하면 fable → 설계 확정 후 구현 분배.
2. 독립 작업은 여러 에이전트에 병렬로 보낸다(같은 파일을 동시에 수정하게 하지 않는다).
3. 대기·출력 읽기는 `worker-watcher`, 최종 판정은 `work-reviewer`(둘 다 `.claude/agents/` 전용 서브에이전트)에 넘긴다. opus는 판정만 보고 통합한다.
4. 구현·리뷰는 Claude Code 서브에이전트(sonnet)에 직접 위임하지 않고 Herdr 워커끼리 협업한다. 작업 시작 전 패널 라벨(이름)부터 확인·지정한다(`herdr-label-models` 스킬).

## 선제 안전장치
- **(a) 실데이터 확인 및 픽스처 작성**: 표시·파싱 작업은 워커가 착수 전 `scripts/usage-live-shape.sh` 결과를 보고하고 그 실데이터로 픽스처·테스트를 만든다. opus의 가정을 지시에 그대로 옮기지 않는다.
- **(b) 검수 관문 (두 단계 필수 통과)**: 둘 다 통과해야만 병합 및 배포를 진행할 수 있다.
  1. **교차 리뷰 (워커)**: 구현자가 아닌 쪽이 독립 리뷰와 실데이터 대조를 수행한다(예: sol 구현 → grok 리뷰, beam·hydro 구현 → sol 리뷰, 핵심 경로는 fable 있을 시 fable 리뷰). opus 지시의 사실 주장이 틀릴 수 있으므로 리뷰어는 지시 자체도 근거와 대조해 독립 검증한다. 리뷰 수행 시 effort high.
  2. **서브에이전트 리뷰 (`work-reviewer`)**: `work-reviewer`(effort high)가 테스트·빌드 실행, 요구사항 및 실데이터 형상 대조를 직접 수행하여 최종 판정(`PASS`/`FIX`)을 내린다. 표시·파싱 기능이면 실데이터 대조 없이는 통과를 줄 수 없다.
- **(c) 배포 완료 알림 게이트**: 배포 후 워커의 기능 대조 보고(실데이터 vs 화면 기대치) 없이는 완료 알림(`discord-notify`)을 보내지 않는다.
- **(d) opus 역할 제한 및 거버넌스**: opus는 코드·설계·스크립트 조사·편집·대기를 직접 하지 않고 워커 또는 `.claude/agents/` 전용 서브에이전트(`worker-watcher`, `work-reviewer`)에 맡기며 `general-purpose`를 쓰지 않는다. 도구 권한 거부(`blocked`) 시 설정을 스스로 고치지 말고 사용자에게 묻는다.
- **(e) 개발 서버 수명**: 워커는 개발 서버를 반드시 백그라운드로 띄우고 자기 PID만 정리한다(포그라운드 서버로 멈춘 사례).
- **(f) main 병합 주인**: main 병합은 opus가 직접 한다(서브에이전트 병합은 자동 모드 판단기가 거부).
- **(g) 시각 산출물 직접 확인**: 아이콘·이미지 등 시각 산출물은 테스트 통과와 별개로 opus가 미리보기 이미지를 직접 열어 확인한다.

## 명령
```bash
herdr agent list                                          # 상태 확인 (idle/done이면 투입 가능)
herdr agent prompt sol "<작업>" --wait --timeout 600000     # 전송 후 완료 대기
herdr agent prompt sol2 "<작업>"                           # 병렬: --wait 없이 보내고
herdr agent wait sol2 --timeout 600000                    #       나중에 대기
herdr agent read sol --source recent-unwrapped --lines 200 # 결과 읽기
```
- `--timeout`은 `--wait`와 함께만 쓴다(`--wait` 없이 `--timeout`을 쓰면 exit 2로 전송되지 않는다).
- 응답이 길면 "결과를 /tmp/<이름>.md에 쓰고 경로만 답하라"고 요청 후 파일을 읽는다.
- `blocked`면 `agent read`로 확인하고, 승인 여부는 사용자에게 묻는다.
- timeout은 전송 실패를 뜻하지 않는다. 같은 프롬프트를 재전송하지 말고 먼저 `agent read`로 확인한다.
- 이름이 안 잡히면 `herdr-label-models` 스킬로 라벨부터 정리한다.

## 프롬프트 작성
- 목표, 범위(파일), 완료 조건, 금지사항을 명시하고 "끝나면 변경 파일 목록과 요약만 보고"로 끝낸다.

## effort 기준 (#1)
| 대상 | effort | 이유 |
|---|---|---|
| opus (조율) | low | 조율·분해·보고만 수행. **예외 없음(상향 금지)** |
| 설계·핵심 경로 리뷰<br>(fable, fable-designer) | high | 아키텍처·인터페이스 설계 및 설계·핵심 경로 리뷰 (**설계·리뷰 예외**) |
| 교차 리뷰·최종 판정<br>(구현자가 아닌 sol/grok 등 워커, fable, work-reviewer) | high | 검수 누락 방지 및 심층 검수 관문 |
| 나머지<br>(구현/조사 워커 sol/beam/grok/hydro 및 필요 시 ds, worker-watcher 등) | medium (없는 도구는 default) | 작업 수행 및 대기·요약 |

- 워커의 effort 변경은 `/effort`로 한다.

> **운영 원칙 (사용자 최종 결정)**:
> - **opus(조율)**: **low 고정, 예외 없음**. 과잉 설계·지연을 방지하기 위해 판단이 무거운 작업(구조 변경·장애 분석)의 상향 규칙에서도 **조율자는 제외**한다.
> - **설계·핵심 경로 리뷰(fable, fable-designer)**: **high**. 설계·핵심 리뷰 품질 보증을 위한 **설계·리뷰 예외**.
> - **교차 리뷰(구현자가 아닌 sol/grok 등 워커, fable)·최종 판정(work-reviewer)**: **high**. 같은 워커라도 **리뷰를 맡을 때는 그 작업에 한해 high**로 올린다.
> - **나머지(구현/조사 워커 sol/beam/grok/hydro 및 필요 시 ds, worker-watcher 등)**: **medium** (미지원 도구는 default).

## 워크트리 (병렬 트랙)
- 같은 파일을 건드릴 수 있는 트랙이 동시에 돌면 레포 내부 `.worktree/`에 워크트리를 만든다(`.gitignore` 등록됨).
  `git worktree add .worktree/<트랙> -b <버전>/<트랙> dev` (예: `.worktree/usage`, 브랜치 `0.2/usage`)
- 워커 지시에 작업 경로 `.worktree/<트랙>`을 명시하고, 그 안에서 `pnpm install`부터 실행하게 한다.
- 통합은 opus가 main에서 merge하고, 끝난 워크트리는 `git worktree remove .worktree/<트랙>`으로 정리한다.

## 이슈 관리
- 작업 단위마다 GitHub 이슈를 만든다. 사용자에게 assign하지 않는다(사용자 수동 작업만 예외). 담당 워커는 본문에 적는다.
- 마일스톤은 버전(`0.1`, `0.2` …), 라벨은 영역 하나만: `design`(ADR·설계) / `frontend` / `backend`(Worker API·수집) / `infra`(배포·DNS·Access·비밀값) / `harness`(에이전트·스킬·스크립트).
- 커밋 메시지에는 `Refs #N`, dev→main PR 본문에 `Closes #N`.
- 작업 묶음이 끝나면 `discord-notify` 스킬로 완료 보고.

## 브랜치·통합
- 원격: `main`(보호: PR 필수, 직접·강제 push·삭제 금지, 관리자 포함), `dev`(통합, 기본 브랜치).
- 워크트리 브랜치는 `dev`에서 따고(`git worktree add .worktree/<트랙> -b <버전>/<트랙> dev`), 검수 통과 후 로컬 `dev`에 `--no-ff` merge → `dev` push.
- **배포 순서**: 비핵심(UI·문서·꺼진 플래그) 변경은 테스트·빌드 통과 후 먼저 배포하고 리뷰는 배포 후에 한다. 수집기·인증·DB 쓰기는 리뷰 후 배포한다.
- **버전**: 배포마다 `package.json` patch 버전을 올린다(README 스크린샷 `pnpm screenshot:readme` 갱신 포함).
- 버전 단위로 `dev → main` PR(`gh pr create -B main -H dev`), 본문에 `Closes #N`. 머지 후 배포는 `main` 기준.
- 기본 브랜치가 `dev`라 `dev→main` PR의 `Closes #N`은 이슈를 자동으로 닫지 않는다. main 병합·배포 확인 후 opus가 이슈를 직접 닫고 마일스톤을 닫는다. dev 커밋에는 `Refs #N`.
