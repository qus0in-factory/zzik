---
name: layered-tdd
description: zzik 코드(프론트 src/, Worker worker/, 수집기 collector/)를 새로 작성·수정하거나 테스트를 쓸 때 사용. ui/app/domain/infra 레이어 배치, 의존 방향, tests/ 경로, BDD 서술, TDD 순서 규칙.
---

# 레이어 + TDD/BDD

상세 근거와 파일별 배정은 `docs/adr/0.2-claude-usage.md` D11·D12. 여기는 작업 규칙만.

## 레이어
| 레이어 | 두는 것 | import 가능 |
|---|---|---|
| ui | 화면·라우트 핸들러. 판정·fetch 금지 | app (domain은 `import type`만) |
| app | 유스케이스·훅·폴러. 포트를 주입받음 | domain |
| domain | 타입·순수 로직·포트(인터페이스). 외부 의존 0 | `shared/`만 |
| infra | fetch·KV·env·시계·Keychain·파일·jose 등 포트 구현 | domain |

- infra 구현은 조립 루트(`src/main.tsx`, `worker/index.ts`, `collector/main.mjs`)에서만 생성·주입. 조립 루트에 로직 금지.
- 실패는 예외 대신 결과 유니온 `{ ok: true, ... } | { ok: false, reason }`. infra가 외부 예외를 변환.
- shadcn 컴포넌트는 `src/ui/components/ui`.

## 테스트
- 위치: `tests/`가 소스 구조를 미러링(`tests/domain/…`, `tests/ui/…`). 공용 가짜 포트는 `tests/fakes/`, 픽스처는 `tests/fixtures/`.
- 서술: `describe('Given …')` / `it('When … Then …')`.
- 순서: 실패 테스트 → 최소 구현 → 리팩터. 레이어는 domain → app → ui/infra 순.
- `vi.mock` 금지, 가짜 포트 주입. 가짜 타이머는 폴러에만. jsdom은 ui 테스트만.
- `tests/arch/layers.test.ts`가 import 방향을 강제한다.
- 완료 조건: `pnpm test`, `pnpm build` 통과.
