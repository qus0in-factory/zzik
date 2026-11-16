---
name: herdr-orchestration
description: opus가 Herdr 워커에 작업을 분배하고 감시자·검수자를 배정할 때 사용. 역할 배정, 워커 협업·교차 리뷰, 프롬프트 전송 명령, fable 사용 제한 규칙 포함. opus 외 에이전트는 이 스킬로 다른 에이전트를 호출하지 않는다.
---

# Herdr 오케스트레이션 (opus 총괄)

## 역할
| 에이전트 | 역할 | 맡기는 일 |
|---|---|---|
| `z-opus` (`opus`) | 총괄·사용자 응대 | 작업 분해·분배, watcher·reviewer 배정, 요약·로컬 스크린샷 직접 판정에 따른 최종 판단·통합과 사용자 보고. 열린 설계 질문 중 기술 선택은 opus가 정하고 근거만 보고한다(비가역·비용·승인 사항만 질문). 조사·구현·대기는 직접 하지 않고 사용자에게 바로 응답할 수 있게 비워 둔다 |
| `z-sol` (`sol`) | 백엔드/수집기 구현·조사·교차 리뷰 (Codex GPT-6.1-Sol) | 설계에 따른 구현, Postgres/DB 연동, 수집기 인프라, 까다로운 디버깅, 외부 API/CLI·동작 원리 조사, 실데이터 검증, 구현자가 아닌 쪽의 교차 리뷰(리뷰 시 high). 탐색·테스트·측정은 sol 내부 보조 서브에이전트(`.codex/agents/` terra) 활용 허용 |
| `beam` | 미배치 | 현재 미배치 (경량 구현/잡무·배포 실행용 역할) |
| `z-grok` (`grok`) | 설계 일부·구현·교차 리뷰 (Grok Build, Grok 4.7 high) | 설계 일부, 기능 구현, 테스트 보강, 구현자가 아닌 쪽의 교차 리뷰(리뷰 시 high) |
| `z-hydro` (`hydro`) | 경량 구현·문서·하네스 동기화 (Antigravity, Gemini 4 Hydrogen medium) | 범위가 명확한 소규모 구현, 문서·하네스·스킬 동기화, 테스트 보강, 리뷰 지적 반영. 설계·운영 배포 제외 |
| `fable` | 미배치 (설계·핵심 경로 리뷰 예외용) | 현재 미배치. 배치 시 아키텍처·인터페이스·데이터 모델 설계, 설계 리뷰·핵심 경로 리뷰(effort high). **구현·잡무 및 코드 수정 금지. 리뷰 검증을 위한 읽기·검색·오라클·테스트 실행은 허용**. 설계는 Herdr fable 패널 또는 fable-designer 서브에이전트(effort high)로 호출 |
| `z-ds` (`ds`) | 경량 구현/잡무·교차 리뷰 (OpenCode, DeepSeek V4.1 Flash) | 범위가 명확한 소규모 구현, 테스트 보강, 하네스·스크립트·문서 동기화, 리뷰 지적 반영, 구현자가 아닌 쪽의 교차 리뷰(리뷰 시 high). 설계·운영 배포·대규모 구조 변경 제외 |
| `.claude/agents/` 전용 서브에이전트<br>(`worker-watcher`, `work-reviewer`, `fable-designer`) | 대기·최종 판정·설계 예외 | opus는 구현·리뷰를 Claude Code 서브에이전트(sonnet)에 직접 위임하지 않고 Herdr 워커끼리 협업한다. 예외는 `worker-watcher`(대기·요약), `work-reviewer`(최종 판정), `fable-designer`(설계 예외)이며, 각 워커가 자기 도구 안에서 쓰는 내부 보조 서브에이전트(예: sol의 `.codex/agents/` terra)는 허용 |

**현재 zzik 워커 구성**: `z-opus`(총괄)·`z-sol`·`z-ds`·`z-grok`·`z-hydro` (워크스페이스별 접두어 라벨 `z-`, `e-` 규칙). `beam`·`fable`은 미배치이며 임의로 추가하지 않는다. `argon` 패널은 쿼터 소진으로 닫았고 `astra` 패널은 사라져 상주 구성에서 제외한다.

## fable 사용 제한 (설계·핵심 리뷰)
- fable은 설계와 핵심 경로 리뷰에만 쓴다. 구현·잡무·코드 수정은 금지한다. 설계·리뷰 검증을 위한 읽기·검색·오라클·테스트 실행은 허용한다.
- 설계 또는 핵심 경로 리뷰가 실제로 필요한 경우에만 호출한다(새 모듈, 구조 변경, 트레이드오프 판단, 핵심 경로 검증). 단순 작업은 절대 보내지 않는다.
- 설계는 Herdr fable 패널 또는 fable-designer 서브에이전트(effort high)로 호출.
- 한 번에 필요한 맥락(목표, 제약, 관련 파일 경로)을 모두 담아 왕복 횟수를 줄인다.
- 결과는 설계안 또는 리뷰 판정만 받는다(/tmp 파일). 문서 워커가 `docs/`에 반영한다.

## 흐름
1. opus가 작업을 분해하고 조사도 워커에 맡긴다. 설계가 필요하면 fable → 설계 확정 후 구현 분배.
2. 독립 작업은 여러 에이전트에 병렬로 보낸다(같은 파일을 동시에 수정하게 하지 않는다).
3. **워커 1명당 `worker-watcher` 1개**를 배정한다. 여러 워커의 대기를 한 watcher에 묶지 않는다. 대기·폴링·출력 읽기는 각 watcher, 최종 판정은 `work-reviewer`(둘 다 `.claude/agents/` 전용 서브에이전트)에 넘긴다. opus는 요약·판정을 받고 통합하며 직접 기다리지 않는다.
4. 구현·리뷰는 Claude Code 서브에이전트(sonnet)에 직접 위임하지 않고 Herdr 워커끼리 협업한다. 작업 시작 전 패널 라벨(이름)부터 확인·지정한다(`herdr-label-models` 스킬). 워커 추가·패널 생성 전 `herdr pane list`와 `herdr agent list`로 기존 배치를 확인해 같은 워커를 중복 실행하지 않는다.

## 선제 안전장치
- **(a) 실데이터 확인 및 픽스처 작성**: 표시·파싱 작업은 워커가 착수 전 `scripts/usage-live-shape.sh` 결과를 보고하고 그 실데이터로 픽스처·테스트를 만든다. opus의 가정을 지시에 그대로 옮기지 않는다.
- **(b) 검수 관문 (두 단계 필수)**: 둘 다 통과해야 한다. 핵심 경로(수집기·인증·DB 쓰기)는 통과 후 병합·배포하고, 비핵심(UI·문서·꺼진 플래그)은 아래 브랜치·통합의 선배포 예외에 따라 배포 후에 통과시킬 수 있다(생략은 불가).
  1. **교차 리뷰 (워커)**: 구현자가 아닌 쪽이 독립 리뷰와 실데이터 대조를 수행한다(예: sol 구현 → grok 리뷰, beam·hydro 구현 → sol 리뷰, 핵심 경로는 fable 있을 시 fable 리뷰). opus 지시의 사실 주장이 틀릴 수 있으므로 리뷰어는 지시 자체도 근거와 대조해 독립 검증한다. 리뷰 수행 시 effort high. 조사 산출물이 있으면 리뷰어에게 경로를 주고 시간대·혜택·적용 대상별 반영 여부를 대조시킨다. 시각·날짜 표시가 있으면 현지 날짜 경계 테스트도 확인한다.
  2. **서브에이전트 리뷰 (`work-reviewer`)**: `work-reviewer`(effort high)가 테스트·빌드 실행, 요구사항 및 실데이터 형상 대조를 직접 수행하여 최종 판정(`PASS`/`FIX`)을 내린다. 호출 시 검수 대상 worktree 경로와 커밋을 넘긴다. 표시·파싱 기능이면 실데이터 대조 없이는 통과를 줄 수 없다.
- **(c) 운영 화면 확인 게이트**: 운영 화면은 사용자가 확인하고, 요청은 opus가 Discord로 보낸다. 워커 기술 검증과 사용자 확인 전에는 완료로 보고하지 않는다. 확인 요청·완료 알림·스크린샷 표기의 세부는 `zzik-deploy` 3절과 `discord-notify` 스킬을 따른다.
- **(d) opus 역할 제한 및 거버넌스**: opus는 웹·문서·코드·설계·스크립트 조사, 구현·편집, 대기·폴링을 직접 하지 않고 워커 또는 `.claude/agents/` 전용 서브에이전트(`worker-watcher`, `work-reviewer`)에 맡기며 `general-purpose`를 쓰지 않는다. 사용자 응대용으로 가용 상태를 유지한다. 열린 설계 질문 중 기술 선택은 opus가 정하고 근거만 보고한다(비가역·비용·승인 사항만 질문). 사용자가 정한 역할·모델·effort·fast 모드·사용량 한도를 임의로 조정하지 않는다. **워커 사용량 한도**: 잔량 경고로 배정을 미루지 않고 리셋 전 1%까지 사용하며, 1% 도달 시 커밋·진행 기록 후 정지한다(사용자 지시 2026-11-16). 도구 권한 거부(`blocked`) 시 설정을 스스로 고치지 말고 사용자에게 묻는다.
- **(e) 개발 서버 수명**: 워커는 개발 서버를 반드시 백그라운드로 띄우고 자기 PID만 정리한다(포그라운드 서버로 멈춘 사례).
- **(f) main 병합 주인**: main 병합은 opus가 직접 한다(서브에이전트 병합은 자동 모드 판단기가 거부).
- **(g) 시각 산출물 확인(두 겹)**: 아이콘·이미지·로컬 화면은 워커가 촬영·검수해 스크린샷 경로와 요약을 보고한다. 그 뒤 **opus가 스크린샷을 직접 열어 최종 판정한다**. 서버 실행·촬영·원인 조사는 워커 몫이고 opus는 보기만 한다. 테스트·워커 검수 통과는 opus 확인을 대체하지 않는다(favicon 흰 배 회귀, off-peak 요일 누락 모두 이 단계에서 발견). 운영 화면의 최종 확인은 (c)에 따라 사용자가 한다.

## 명령
```bash
herdr pane list                                          # 워커 추가 전 기존 pane ID·배치 확인
herdr agent list                                         # 이름·상태 확인 후 기존 워커 재사용
herdr agent prompt sol "<작업>"                           # opus: 완료 대기 없이 전송
# 아래 대기·읽기는 sol 전담 worker-watcher가 실행한다.
herdr agent wait sol --timeout 590000
herdr agent read sol --source recent-unwrapped --lines 200
herdr pane read w2J:pN --source recent-unwrapped --lines 200 # pane ID를 아는 경우만
```
- `herdr pane read` 인자는 pane ID(예: `w2J:pN`)다. 에이전트 이름으로 읽을 때는 `herdr agent read <이름>`을 쓴다(`herdr pane read sol` 금지).
- `herdr agent prompt`의 `--timeout`은 `--wait`와 함께만 쓴다(`--wait` 없이 붙이면 exit 2로 전송되지 않는다). watcher의 별도 명령 `herdr agent wait <이름> --timeout …`에는 이 제한이 없다.
- 응답이 길면 "결과를 /tmp/<이름>.md에 쓰고 경로만 답하라"고 요청한다. 전담 watcher가 파일을 읽어 요약한다.
- `blocked`면 watcher가 `agent read`로 확인해 보고하고, 승인 여부는 사용자에게 묻는다.
- timeout은 전송 실패를 뜻하지 않는다. 같은 프롬프트를 재전송하지 말고 먼저 watcher가 `agent read`로 확인한다.
- 이름이 안 잡히면 `herdr-label-models` 스킬로 라벨부터 정리한다.
- **운영 팁**: macOS에는 `timeout` 명령이 없으므로 쓰지 않는다. `herdr pane run`은 대기할 수 있으므로 새 패널에서 CLI 실행은 `herdr pane send-text <pane> "<cmd>"` + `herdr pane send-keys <pane> enter`로 보낸다. 새 패널을 띄운 뒤에는 `herdr agent rename <pane> <이름>`으로 이름을 지정한다.

## 프롬프트 작성
- 목표, 범위(파일·worktree·검수 대상 커밋), 완료 조건, 금지사항을 명시하고 "끝나면 변경 파일 목록과 요약만 보고"로 끝낸다.
- watcher에는 워커 이름 1개, 작업 전송 시각, 작업별 결과 파일 경로와 기존 파일의 갱신 기준을 넘긴다. 가능하면 작업마다 새 결과 경로를 사용한다. 이전 턴의 idle/done을 완료로 오인하지 않게 한다.
- 완료 조건에는 시각 산출물의 스크린샷 경로·실데이터/fixture 여부, 조사 항목 대조, ADR 상태·실제 문구 키·계약 동기화를 포함한다.
- **프롬프트 조립에 `printf`를 쓰지 않는다.** 본문의 `50%)` 같은 `%`가 형식 지시자로 해석되어 뒷부분이 잘릴 수 있다. quoted heredoc으로 원문을 보존하고 변수는 인용해 전달한다.

```bash
PROMPT=$(cat <<'TASK'
목표: 할인 50% 문구를 반영한다.
범위·금지사항·TDD·검증·커밋·결과 파일 경로를 빠짐없이 적는다.
TASK
)
herdr agent prompt sol "$PROMPT"
```

## effort 기준
| 대상 | effort | 이유 |
|---|---|---|
| opus (조율) | low | 조율·분해·보고만 수행. **예외 없음(상향 금지)** |
| 설계·핵심 경로 리뷰<br>(fable, fable-designer) | high | 아키텍처·인터페이스 설계 및 설계·핵심 경로 리뷰 (**설계·리뷰 예외**) |
| 교차 리뷰·최종 판정<br>(구현자가 아닌 sol/grok 등 워커, fable, work-reviewer) | high | 검수 누락 방지 및 심층 검수 관문 |
| 나머지<br>(구현/조사 워커 sol/grok/hydro/ds 및 재배치 시 beam, worker-watcher 등) | medium (없는 도구는 default) | 작업 수행 및 대기·요약 |

### CLI별 effort·fast 변경 키 순서

사용자가 정한 역할·설정 및 위 기준에 따른 변경에만 사용한다. 모든 CLI에 `/effort`를 보내지 않는다. 보내기 전 `herdr agent read <이름> --source visible --lines 5`로 입력란을 확인하고 적용 후 같은 명령으로 상태줄·메뉴의 실제 값을 확인한다. 키 전송 형식은 `herdr agent send-keys <이름> <KEY>...`다.

| CLI | 키 순서 |
|---|---|
| Claude (`opus`·`fable`) | `/effort high` 입력 → Enter **1회**(해당 역할이 high일 때만; opus는 low 고정) |
| Codex (`sol`) fast | `/fast` 입력 → **Tab → Enter**, 또는 Enter 2회. 슬래시 팝업 선택과 실행을 구분하고 변경 후 fast 상태 확인 |
| Codex (`sol`) effort | `/model` 입력 → **Tab → Enter**, 또는 Enter 2회 → 모델 선택 → **Reasoning 메뉴**에서 지정 effort 선택 |
| agy/Antigravity (`hydro`) | `/model` 입력 → **Tab → Enter** → **←/→**로 지정 effort 선택 |

- 메뉴 선택 전송 예: `herdr agent send-keys sol tab enter`. 입력줄 지우기 예: `herdr agent send-keys sol ctrl+e ctrl+u`(끝으로 이동 후 커서 앞 입력 삭제). `esc`는 메뉴 닫기에 쓴다. `send-keys --help`는 전송 형식·esc만 확인해 주므로 tab·enter·ctrl+e·ctrl+u의 CLI별 동작은 빈 테스트 입력란에서 먼저 검증하고, 적용 후 visible 읽기로 빈 입력을 확인한다. 키가 지원되지 않거나 전체 입력이 지워지지 않으면 실제 지시를 보내지 말고 중단·보고한다.
- Escape만으로 입력이 지워진다고 가정하지 않는다. 메뉴를 닫은 뒤 입력란에 `/` 등이 남으면 전체를 지우고, 빈 입력란에서 다시 시작한다. `//model`이 일반 프롬프트로 전송되지 않게 확인한다.
- 다른 CLI의 키는 추측해서 실행하지 말고 해당 CLI 도움말로 확인한다.

> **운영 원칙 (사용자 최종 결정)**:
> - **opus(조율)**: **low 고정, 예외 없음**. 과잉 설계·지연을 방지하기 위해 판단이 무거운 작업(구조 변경·장애 분석)의 상향 규칙에서도 **조율자는 제외**한다.
> - **설계·핵심 경로 리뷰(fable, fable-designer)**: **high**. 설계·핵심 리뷰 품질 보증을 위한 **설계·리뷰 예외**.
> - **교차 리뷰(구현자가 아닌 sol/grok 등 워커, fable)·최종 판정(work-reviewer)**: **high**. 같은 워커라도 **리뷰를 맡을 때는 그 작업에 한해 high**로 올린다.
> - **나머지(구현/조사 워커 sol/grok/hydro/ds 및 재배치 시 beam, worker-watcher 등)**: **medium** (미지원 도구는 default).

## 워크트리 (병렬 트랙)
- 같은 파일을 건드릴 수 있는 트랙이 동시에 돌면 레포 내부 `.worktree/`에 워크트리를 만든다(`.gitignore` 등록됨).
  `git worktree add .worktree/<트랙> -b <버전>/<트랙> dev` (예: `.worktree/usage`, 브랜치 `0.2/usage`)
- 워커 지시에 작업 경로 `.worktree/<트랙>`을 명시하고, 그 안에서 `pnpm install`부터 실행하게 한다.
- 통합은 opus가 로컬 dev에서 merge하고(main은 dev→main PR), 끝난 워크트리는 `git worktree remove .worktree/<트랙>`으로 정리한다.

## 이슈 관리
- 작업 단위마다 GitHub 이슈를 만든다. 사용자에게 assign하지 않는다(사용자 수동 작업만 예외). 담당 워커는 본문에 적는다.
- 마일스톤은 버전(`0.1`, `0.2` …), 라벨은 영역 하나만: `design`(ADR·설계) / `frontend` / `backend`(Worker API·수집) / `infra`(배포·DNS·Access·비밀값) / `harness`(에이전트·스킬·스크립트).
- 커밋 메시지에는 `Refs #N`, dev→main PR 본문에 `Closes #N`.
- 작업 묶음이 끝나면 `discord-notify` 스킬로 완료 보고.

## 브랜치·통합
- 원격: `main`(보호: PR 필수, 직접·강제 push·삭제 금지, 관리자 포함), `dev`(통합, 기본 브랜치).
- 워크트리 브랜치는 `dev`에서 따고(`git worktree add .worktree/<트랙> -b <버전>/<트랙> dev`), 아래 배포 순서의 조건을 충족한 뒤 로컬 `dev`에 `--no-ff` merge → `dev` push.
- **배포 순서**: 비핵심(UI·문서·꺼진 플래그) 변경은 테스트·빌드 통과 후 먼저 배포할 수 있고 두 관문은 배포 후 반드시 수행한다. 수집기·인증·DB 쓰기는 두 관문 통과 후 배포한다. 시각 산출물은 선배포 여부와 무관하게 (g)를 배포 전에, 운영 완료 보고는 (c)를 충족한다.
- **버전**: 배포마다 `package.json` patch 버전을 올린다(README 스크린샷 `pnpm screenshot:readme` 갱신 포함).
- 버전 단위로 `dev → main` PR(`gh pr create -B main -H dev`), 본문에 `Closes #N`. 머지 후 배포는 `main` 기준.
- 기본 브랜치가 `dev`라 `dev→main` PR의 `Closes #N`은 이슈를 자동으로 닫지 않는다. main 병합·배포 확인 후 opus가 이슈를 직접 닫고 마일스톤을 닫는다. dev 커밋에는 `Refs #N`.
