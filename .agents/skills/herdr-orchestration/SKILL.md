---
name: herdr-orchestration
description: 총괄 에이전트가 워커에 작업을 나누거나 직접 처리하고 Herdr 패널을 다룰 때 사용. 역할 분담, 프롬프트 전송, 라벨링, 병합·릴리스, 운영 팁 포함.
---

# Herdr 오케스트레이션

## 에이전트 구성
- 현재 에이전트 구성·모델·역할·배정 대상과 워크스페이스 접두어 규칙은 `docs/harness/agents.md` 참고.

## 리뷰·승인·비밀값
리뷰는 운영 데이터 쓰기·삭제 등 위험한 변경에만 필요할 때 가볍게 한다. 비가역 작업(운영 데이터 삭제, Neon 삭제, 되돌릴 수 없는 배포 등)은 사용자 승인을 받는다. 비밀값과 원문 응답은 로그·보고서에 출력하지 않는다.

## 흐름
1. 총괄 에이전트가 작업을 쪼개 워커에 맡기거나 직접 한다(배정 기준은 `docs/harness/agents.md` 참고). 같은 파일을 동시에 수정하지 않게 한다.
2. 시작 전 패널 라벨을 확인·지정하고(`herdr-label-models` 스킬), `herdr pane list`·`herdr agent list`로 기존 배치를 확인해 같은 워커를 중복 실행하지 않는다.
3. **작업 크기**: 한 번에 맡기는 일은 가능하면 워커가 5분 안에 끝낼 크기로, 어쩔 수 없으면 15분 안으로 쪼갠다. 진행 중인 워커에 후속 요청을 덧붙이지 말고 새 조각으로 만들어 쉬는 워커에 준다. 한 워커에 일이 몰리면 남은 일을 15분 이하 조각으로 다시 나눠 다른 워커에 넘긴다.
   - 워커 대기는 Monitor 대신 `worker-watcher` 서브에이전트(워커 1명당 1개)에 맡겨 총괄 컨텍스트를 아낀다(2026-11-17 재도입). 현재 구성은 `docs/harness/agents.md`.
4. 총괄 에이전트가 결과를 받아 통합하고 로컬 `dev` 병합 → `dev→main` PR → 릴리스를 직접 한다. 작업 묶음이 어느 정도 도입되면 `scripts/ship.mjs`로 릴리스·배포·Discord 알림까지 한 번에 한다. 개발 서버는 백그라운드로 띄우고 자기 PID만 정리한다.

## 대기·감시
Monitor/폴링은 상태 변화나 최종 판정만 출력한다. 분 단위 진행 알림은 금지한다. 결과를 한 번만 내는 스크립트(`scripts/herdr-wait-result.mjs`, `scripts/d1-status.mjs --wait-fresh`(작성 중))를 우선한다.

## 테스트
워커는 작업 중 관련 테스트(vitest related/해당 파일)와 typecheck만 돌린다. 전체 스위트는 CI(`dev→main` PR)가 게이트다. 총괄 에이전트는 워커가 돌린 테스트를 다시 돌리지 않는다.

## 문서
한국어 띄어쓰기를 지우지 않는다(`scripts/check-hangul-spacing.mjs`로 검사).

## 사용량 한도
fast·모델 변경은 사용자에게 맡기고, effort는 opus가 작업 성격에 맞춰 조절한다. 현재 한도·effort 지시는 `docs/harness/agents.md` 참고. 워커는 작게 자주 커밋하고 결과 파일에 완료·진행 중·남은 일을 수시로 갱신한다. 소진 시 총괄 에이전트가 해당 worktree와 기록을 다른 워커에 승계한다. 사용자가 정한 역할·모델·fast 모드를 임의로 바꾸지 않는다. 도구 권한 거부(`blocked`) 시 설정을 스스로 고치지 말고 사용자에게 묻는다.

## 명령
```bash
herdr pane list                                          # 워커 추가 전 기존 pane ID·배치 확인
herdr agent list                                         # 이름·상태 확인 후 기존 워커 재사용
herdr agent prompt <이름> "<작업>"                        # 완료 대기 없이 전송
herdr agent read <이름> --source recent-unwrapped --lines 200
herdr pane read w2J:pN --source recent-unwrapped --lines 200 # pane ID를 아는 경우만
```
- `herdr pane read` 인자는 pane ID(예: `w2J:pN`)다. 에이전트 이름으로 읽을 때는 `herdr agent read <이름>`을 쓴다(`herdr pane read sol` 금지).
- `herdr agent prompt`의 `--timeout`은 `--wait`와 함께만 쓴다(`--wait` 없이 붙이면 exit 2로 전송되지 않는다).
- 응답이 길면 "결과를 /tmp/<이름>.md에 쓰고 경로만 답하라"고 요청한다.
- `blocked`면 `agent read`로 확인하고 승인 여부는 사용자에게 묻는다. timeout은 전송 실패를 뜻하지 않으므로 같은 프롬프트를 바로 재전송하지 않는다.
- 이름이 안 잡히면 `herdr-label-models` 스킬로 라벨부터 정리한다.
- 결과 파일 mtime 또는 에이전트 idle/done 대기는 `scripts/herdr-wait-result.mjs`(`--max-wait-ms`). 작업 직후 `agent_idle`이 잠깐 나올 수 있으니 결과 파일이 없으면 다시 기다린다.
- 첫 지시 전에 TUI에 선택 창(OpenCode `Select model`·`Select variant` 등)이 열려 있지 않은지 `herdr agent read`로 확인한다. 열려 있으면 지시문이 검색칸에 들어가 사라진다. 상태줄 한 줄만 grep하면 창 뒤의 상태줄이 잡혀 놓친다.
- **운영 팁**: macOS에는 `timeout` 명령이 없으므로 쓰지 않는다. `herdr pane run`은 대기할 수 있으므로 새 패널에서 CLI 실행은 `herdr pane send-text <pane> "<cmd>"` + `herdr pane send-keys <pane> enter`로 보낸다. 새 패널을 띄운 뒤에는 `herdr agent rename <pane> <이름>`으로 이름을 지정한다.

## 프롬프트 작성
- 목표, 범위(파일·worktree), 완료 조건, 금지사항을 명시하고 "끝나면 변경 파일 목록과 요약만 보고"로 끝낸다.
- **프롬프트 조립에 `printf`를 쓰지 않는다.** 본문의 `50%)` 같은 `%`가 형식 지시자로 해석되어 뒷부분이 잘릴 수 있다. quoted heredoc으로 원문을 보존하고 변수는 인용해 전달한다.

```bash
PROMPT=$(cat <<'TASK'
목표: 할인 50% 문구를 반영한다.
범위·금지사항·TDD·검증·커밋·결과 파일 경로를 빠짐없이 적는다.
TASK
)
herdr agent prompt <이름> "$PROMPT"
```

## 워크트리 (병렬 트랙)
- 같은 파일을 건드릴 수 있는 트랙이 동시에 돌면 레포 내부 `.worktree/`에 워크트리를 만든다(`.gitignore` 등록됨).
  `git worktree add .worktree/<트랙> -b <버전>/<트랙> dev` (예: `.worktree/usage`, 브랜치 `0.2/usage`)
- 코드 작업 워커에는 브랜치만 주지 말고 항상 워크트리 경로를 준다(메인 체크아웃 브랜치가 바뀜). 일은 지시 전에 조사·구현·문서로 나눠 동시에 보낸다.
- 작업 경로 `.worktree/<트랙>`을 명시하고 그 안에서 `pnpm install`부터 실행한다.
- 끝난 워크트리는 `git worktree remove .worktree/<트랙>`으로 정리한다.
- 생성·dev `--no-ff` 병합·제거는 `scripts/worktree-track.mjs`(기본 dry-run, `--apply`만 실행). 생성은 `create <트랙> <버전>`으로 버전 인자가 필수다. 사용법은 `--help`.
- `ship.mjs`가 도는 동안에는 dev에 병합하지 않는다(릴리스 커밋과 섞인다). 끝난 뒤 병합한다.

## 브랜치·통합
- 원격: `main`(보호: PR 필수, 직접·강제 push·삭제 금지), `dev`(통합, 기본 브랜치).
- 워크트리 브랜치는 `dev`에서 따고 로컬 `dev`에 `--no-ff` merge → `dev` push.
- 배포마다 `package.json` patch 버전을 올리고, 버전 단위로 `dev → main` PR(`gh pr create -B main -H dev`)을 만든다. 머지 후 배포는 `main` 기준.
- 기본 브랜치가 `dev`라 `dev→main` PR의 `Closes #N`은 이슈를 자동으로 닫지 않는다. 병합·배포 확인 후 총괄 에이전트가 이슈와 마일스톤을 직접 닫는다.

## 이슈 관리
- 작업 단위마다 GitHub 이슈를 만들고 사용자에게 assign하지 않는다(사용자 수동 작업만 예외). 담당 에이전트는 본문에 적는다.
- 라벨은 영역 하나만: `design` / `frontend` / `backend` / `infra` / `harness`. 커밋 메시지에는 `Refs #N`, dev→main PR 본문에 `Closes #N`.
- 작업 묶음이 끝나면 `discord-notify` 스킬로 완료 보고.
