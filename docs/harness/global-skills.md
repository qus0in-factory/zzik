# 전역 스킬·서브에이전트 공유 (정본 `~/.agents`)

정본은 홈 디렉터리 `~/.agents/`에 있고(저장소 밖), 도구별 경로는 심볼릭 링크 또는 도구의 기본 탐색 경로로 공유한다. 홈의 설정 파일(settings.json, config.toml)은 건드리지 않는다.

## 스킬 (정본 `~/.agents/skills/<이름>/SKILL.md`, frontmatter `name`·`description`)
| 도구 | 전역 스킬 경로 | 방식 |
|---|---|---|
| Claude Code | `~/.claude/skills/<이름>` | 스킬 단위 심볼릭 링크 |
| Codex | `$CODEX_HOME/skills`, **`~/.agents/skills`** | `~/.agents/skills`를 기본 탐색(링크 불필요, 중복 방지) |
| OpenCode | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | 위 경로 중 `~/.claude/skills` 링크·`~/.agents/skills`로 인식 |
| agy (Antigravity CLI) | `~/.gemini/config/skills/<이름>` | 스킬 단위 심볼릭 링크(`~/.agents/skills`는 읽지 않음) |
| Gemini CLI | `~/.gemini/skills`, **`~/.agents/skills`** | `~/.agents/skills`를 기본 탐색 |

전역 스킬: herdr-orchestration, herdr-label-models, agents-md-authoring, layered-tdd, discord-notify, gemini-image-gen (+ 기존 herdr).
프로젝트 전용(전역 제외): zzik-deploy, zzik-usage-collector.

## 서브에이전트
| 도구 | 정본 | 전역 위치 | 방식 |
|---|---|---|---|
| Claude Code | `~/.agents/agents/claude/*.md` | `~/.claude/agents/<이름>.md` | 파일 단위 심볼릭 링크 |
| OpenCode | `~/.agents/agents/opencode/*.md` | `~/.config/opencode/agents/<이름>.md` | 파일 단위 심볼릭 링크(`mode: subagent`, `permission`) |
| Codex | `~/.agents/agents/codex/*.toml` (explorer, test-runner, db-probe, deploy-checker) | `~/.codex/agents/<이름>.toml` | 파일 단위 심볼릭 링크. 이 저장소 `.codex/agents/`(sol 정의)를 일반화한 것 — zzik 전용 내용(DB_URL·zzik-deploy 8경로)은 프로젝트 정의에만 남기며, 같은 이름은 프로젝트 정의가 우선한다. 홈 `config.toml`의 `[agents]` 설정은 건드리지 않는다 |
| agy | — | — | 파일 기반 전역 서브에이전트 정의 없음(런타임 `invoke_subagent` 도구) |

기존 파일은 덮어쓰지 않고 `~/.agents/skill-backups/<날짜>-global-skills/`에 백업한 뒤 링크한다.

확인: `codex debug prompt-input`의 `Available roles`에 네 이름이 나온다(프로젝트 `.codex` 없는 디렉터리에서도).
