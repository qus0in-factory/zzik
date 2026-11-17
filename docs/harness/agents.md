# 에이전트 구성 및 모델 라벨

이 문서는 자주 바뀌는 에이전트 구성·모델·역할·라벨 매핑의 현재 정본이다. 절차는 `herdr-orchestration`, `herdr-label-models` 스킬을 따른다.

## 에이전트 구성 (2026-11-16 사용자 결정, 2026-11-17 `z-hyd`·`z-fable`·`z-astra` 추가)

| 에이전트 | 역할 | 도구·모델 |
|---|---|---|
| `z-opus` (`opus`) | 사용자 응대·총괄·병합·릴리스. 조사·구현·편집·대기를 직접 해도 된다. | Claude Code (Opus) |
| `z-sol` (`sol`) | 백엔드·수집기 구현, DB 연동, 까다로운 디버깅·조사 | Codex (`GPT-6.1-Sol`, Fast) |
| `z-ds` (`ds`) | 경량 구현·잡무, 하네스·스크립트·문서 동기화 | OpenCode (`DeepSeek V4.1 Flash`) |
| `z-hf` (`hf`) | 소규모 구현·문서 동기화·가벼운 확인 | OpenCode (`Hy4 flash Free`) |
| `z-hyd` (`hydro`) | 문서·하네스 동기화, 범위가 명확한 소규모 구현, 테스트 보강 | Antigravity CLI (`Gemini 4 Hydrogen`, medium) |
| `z-fable` (`fable`) | 설계·리뷰 전용. 파일 수정·커밋 금지(읽기·검색·테스트 실행은 허용). 결과는 `/tmp/fable-<주제>.md` | Claude Code (`Fable 5.1`, high) |
| `z-astra` (`astra`) | 설계·리뷰 전용(주로 구현 코드 리뷰, `z-fable`과 분담). 파일 수정·커밋 금지. 결과는 `/tmp/astra-<주제>.md` | Codex (`GPT-6-Astra`, high, Fast) |

- `z-grok`은 한도가 남을 때만 쓰고 소진되면 다른 워커가 승계한다.

## 사용량 한도·effort (2026-11-17 사용자 지시)

- opus는 작업 성격에 맞춰 워커 effort를 조절할 수 있다(2026-11-17 사용자 허용). fast·모델 변경은 사용자에게 맡긴다. Codex 계열은 현재 Fast를 쓴다. `z-sol`·`z-astra`는 손이 가는 일(탐색·테스트·측정·배포 확인)을 `.codex/agents`의 GPT-6.1 Terra 서브에이전트에 위임하고 판단·설계·통합·최종 검토를 맡는다(2026-11-17 사용자 지시).
- 한도를 의식하지 않고 소진까지 사용하며, 잔량 경고로 배정을 미루지 않는다.

## 워크스페이스 라벨·상주 구성

- 워크스페이스별 접두어 라벨(`z-`, `e-`) 규칙을 따른다.
- `zzik` 워크스페이스 상주 구성: 위 에이전트 구성 표와 같다.
- 닫힌 패널 감지 규칙은 재사용 대비로 남기되 `argon`·`astra`는 상주 구성에서 제외한다.

## 모델 약칭 및 감지 매핑

- `agent` 필드 1차 판정: `codex`→`sol`, `grok`→`grok`.
- 하단 상태줄(비어 있지 않은 마지막 5줄) 판정:
  - `agy`: `Gemini <버전> Hydrogen` 또는 `Hydrogen`→`hydro`, 그 외 `Gemini <버전>`→`gemini`.
  - `opencode`: `GPT-<버전>-Sol`→`sol`, `DeepSeek <버전>`→`ds`, `Hy<버전>`→`hy`, `Hy4 flash`→`hf`(`hy`와 구분), `GLM-<버전>`→`glm`, `Beam Free`→`beam`.
  - `claude`: `Opus|Fable|Sonnet <버전>`→`opus`|`fable`|`sonnet`(마지막 줄 우선).
