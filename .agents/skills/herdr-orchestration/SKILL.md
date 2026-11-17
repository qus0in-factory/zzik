---
name: herdr-orchestration
description: opus가 z-sol·z-ds·z-hf에 작업을 나누거나 직접 처리하고 Herdr 패널을 다룰 때 사용. 역할 분담, 프롬프트 전송, 라벨링, 병합·릴리스, 운영 팁 포함.
---

# Herdr 오케스트레이션 (opus 총괄)

## 현재 구성 (2026-11-16 사용자 결정)
| 에이전트 | 역할 |
|---|---|
| `z-opus` (`opus`) | 사용자 응대·총괄·병합·릴리스. 조사·구현·편집·대기를 직접 해도 된다. |
| `z-sol` (`sol`) | 백엔드·수집기 구현, DB 연동, 까다로운 디버깅·조사 (Codex GPT-6.1-Sol) |
| `z-ds` (`ds`) | 경량 구현·잡무, 하네스·스크립트·문서 동기화 (OpenCode, DeepSeek V4.1 Flash) |
| `z-hf` (`hf`) | 소규모 구현·문서 동기화·가벼운 확인 (OpenCode, Hy4 flash Free) |

`z-grok`·`z-hydro`는 배정 대상이 아니다. 워크스페이스별 접두어 라벨(`z-`, `e-`)은 유지한다.

## 리뷰·승인·비밀값
리뷰는 운영 데이터 쓰기·삭제 등 위험한 변경에만 필요할 때 가볍게 한다. 비가역 작업(운영 데이터 삭제, Neon 삭제, 되돌릴 수 없는 배포 등)은 사용자 승인을 받는다. 비밀값과 원문 응답은 로그·보고서에 출력하지 않는다.

## 흐름
1. opus가 작업을 쪼개 `z-sol`·`z-ds`·`z-hf`에 맡기거나 직접 한다. 같은 파일을 동시에 수정하지 않게 한다.
2. 시작 전 패널 라벨을 확인·지정하고(`herdr-label-models` 스킬), `herdr pane list`·`herdr agent list`로 기존 배치를 확인해 같은 워커를 중복 실행하지 않는다.
3. opus가 결과를 받아 통합하고 로컬 `dev` 병합 → `dev→main` PR → 릴리스를 직접 한다. 개발 서버는 백그라운드로 띄우고 자기 PID만 정리한다.

## 대기·감시
Monitor/폴링은 상태 변화나 최종 판정만 출력한다. 분 단위 진행 알림은 금지한다. 결과를 한 번만 내는 스크립트(`scripts/herdr-wait-result.mjs`, `scripts/d1-status.mjs --wait-fresh`(작성 중))를 우선한다.

## 테스트
워커는 작업 중 관련 테스트(vitest related/해당 파일)와 typecheck만 돌린다. 전체 스위트는 CI(`dev→main` PR)가 게이트다. opus는 워커가 돌린 테스트를 다시 돌리지 않는다.

## 문서
한국어 띄어쓰기를 지우지 않는다(`scripts/check-hangul-spacing.mjs`, 작성 중).

## 사용량 한도
한도 판단·변경(fast·effort·모델 조정)은 사용자에게 맡긴다. 한도를 의식하지 않고 소진까지 사용하며, 잔량 경고로 배정을 미루지 않는다(2026-11-17 사용자 지시). 워커는 작게 자주 커밋하고 결과 파일에 완료·진행 중·남은 일을 수시로 갱신한다. 소진 시 opus가 해당 worktree와 기록을 다른 워커에 승계한다. 사용자가 정한 역할·모델·effort·fast 모드를 임의로 바꾸지 않는다. 도구 권한 거부(`blocked`) 시 설정을 스스로 고치지 말고 사용자에게 묻는다.

## 명령
```bash
herdr pane list                                          # 워커 추가 전 기존 pane ID·배치 확인
herdr agent list                                         # 이름·상태 확인 후 기존 워커 재사용
herdr agent prompt sol "<작업>"                           # opus: 완료 대기 없이 전송
herdr agent read sol --source recent-unwrapped --lines 200
herdr pane read w2J:pN --source recent-unwrapped --lines 200 # pane ID를 아는 경우만
```
- `herdr pane read` 인자는 pane ID(예: `w2J:pN`)다. 에이전트 이름으로 읽을 때는 `herdr agent read <이름>`을 쓴다(`herdr pane read sol` 금지).
- `herdr agent prompt`의 `--timeout`은 `--wait`와 함께만 쓴다(`--wait` 없이 붙이면 exit 2로 전송되지 않는다).
- 응답이 길면 "결과를 /tmp/<이름>.md에 쓰고 경로만 답하라"고 요청한다.
- `blocked`면 `agent read`로 확인하고 승인 여부는 사용자에게 묻는다. timeout은 전송 실패를 뜻하지 않으므로 같은 프롬프트를 바로 재전송하지 않는다.
- 이름이 안 잡히면 `herdr-label-models` 스킬로 라벨부터 정리한다.
- 결과 파일 mtime 또는 에이전트 idle/done 대기는 `scripts/herdr-wait-result.mjs`(`--max-wait-ms`).
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
herdr agent prompt sol "$PROMPT"
```

## 워크트리 (병렬 트랙)
- 같은 파일을 건드릴 수 있는 트랙이 동시에 돌면 레포 내부 `.worktree/`에 워크트리를 만든다(`.gitignore` 등록됨).
  `git worktree add .worktree/<트랙> -b <버전>/<트랙> dev` (예: `.worktree/usage`, 브랜치 `0.2/usage`)
- 작업 경로 `.worktree/<트랙>`을 명시하고 그 안에서 `pnpm install`부터 실행한다.
- 끝난 워크트리는 `git worktree remove .worktree/<트랙>`으로 정리한다.
- 생성·dev `--no-ff` 병합·제거는 `scripts/worktree-track.mjs`(기본 dry-run, `--apply`만 실행). 사용법은 `--help`.

## 브랜치·통합
- 원격: `main`(보호: PR 필수, 직접·강제 push·삭제 금지), `dev`(통합, 기본 브랜치).
- 워크트리 브랜치는 `dev`에서 따고 로컬 `dev`에 `--no-ff` merge → `dev` push.
- 배포마다 `package.json` patch 버전을 올리고, 버전 단위로 `dev → main` PR(`gh pr create -B main -H dev`)을 만든다. 머지 후 배포는 `main` 기준.
- 기본 브랜치가 `dev`라 `dev→main` PR의 `Closes #N`은 이슈를 자동으로 닫지 않는다. 병합·배포 확인 후 opus가 이슈와 마일스톤을 직접 닫는다.

## 이슈 관리
- 작업 단위마다 GitHub 이슈를 만들고 사용자에게 assign하지 않는다(사용자 수동 작업만 예외). 담당 에이전트는 본문에 적는다.
- 라벨은 영역 하나만: `design` / `frontend` / `backend` / `infra` / `harness`. 커밋 메시지에는 `Refs #N`, dev→main PR 본문에 `Closes #N`.
- 작업 묶음이 끝나면 `discord-notify` 스킬로 완료 보고.
