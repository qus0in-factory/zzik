import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/** scripts/herdr-label-models.sh의 detect()를 source해서 호출한다(실행부는 HERDR_LABEL_SOURCE_ONLY=1로 건너뜀). */
function detect(agent: string, screen: string): string {
  const result = spawnSync('bash', ['-c', 'source scripts/herdr-label-models.sh; detect "$1" "$2"', '_', agent, screen], {
    env: { ...process.env, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w', HERDR_LABEL_SOURCE_ONLY: '1' },
    encoding: 'utf8',
  })
  return result.stdout.trim()
}

const filler = (n: number) => Array.from({ length: n }, (_, i) => `대화 본문 ${i}`).join('\n')

describe('Given the herdr label detection', () => {
  it('When the agent kind is unambiguous Then the kind decides without reading the screen', () => {
    expect(detect('codex', 'Opus 5.5 · 인용문')).toBe('sol')
    expect(detect('agy', 'Fable 5.2 with high effort')).toBe('gemini')
  })
  it('When opencode shows a model in the bottom lines Then Grok or GPT-Sol is told apart', () => {
    expect(detect('opencode', `${filler(10)}\n  ┃  Build auto · Grok 4.7 xAI · high`)).toBe('grok')
    expect(detect('opencode', `${filler(10)}\n  GPT-6.1-Sol medium · ~/zzik`)).toBe('sol')
    expect(detect('opencode', filler(10))).toBe('')
  })
  it('When opencode shows a DeepSeek model in the bottom lines Then it is labeled ds', () => {
    expect(detect('opencode', `${filler(10)}\n  DeepSeek V4.1 Flash · ~/zzik`)).toBe('ds')
    expect(detect('opencode', `${filler(10)}\n  DeepSeek 4.1 · opencode-go`)).toBe('ds')
    expect(detect('opencode', `DeepSeek V4.1 Flash 인용문\n${filler(10)}\n? for shortcuts`)).toBe('')
  })
  it('When opencode shows a Hy model in the bottom lines Then it is labeled hy', () => {
    expect(detect('opencode', `${filler(10)}\n  Hy4 · opencode-go`)).toBe('hy')
    expect(detect('opencode', `${filler(10)}\n  Build auto · Hy4.1 · default`)).toBe('hy')
    expect(detect('opencode', `Hy4 로 전환 기록\n${filler(10)}\n? for shortcuts`)).toBe('')
    expect(detect('opencode', `${filler(10)}\n  Hy · 버전 없음`)).toBe('')
  })
  it('When claude shows a versioned model in the bottom lines Then it is detected', () => {
    expect(detect('claude', `${filler(10)}\n  Opus 5.5 (1M context)\n`)).toBe('opus')
    expect(detect('claude', `${filler(10)}\n  Sonnet 5.5 · Claude Max\n\n\n`)).toBe('sonnet')
  })
  it('When claude text quotes a model name above the bottom lines Then it is not fooled', () => {
    const screen = `"Fable 5.2"로 바꿨다\nSonnet 5.5 로 전환 기록\n${filler(8)}\n? for shortcuts`
    expect(detect('claude', screen)).toBe('')
  })
  it('When no model is visible Then empty so the caller skips', () => {
    expect(detect('claude', filler(10))).toBe('')
    expect(detect('claude', '')).toBe('')
  })
})

describe('Given the labeling run with a fake herdr', () => {
  async function run(extraEnv: Record<string, string> = {}, args: string[] = []) {
    const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'fake-herdr-'))
    const log = join(dir, 'calls.log')
    const agents = {
      result: {
        agents: [
          { pane_id: 'w:p1', tab_id: 'w:t1', agent: 'codex', name: null, workspace_id: 'w' },
          { pane_id: 'w:p2', tab_id: 'w:t2', agent: 'agy', name: null, workspace_id: 'w' },
          { pane_id: 'w:p3', tab_id: 'w:t3', agent: 'codex', name: 'sol', workspace_id: 'w' },
        ],
      },
    }
    writeFileSync(join(dir, 'agents.json'), JSON.stringify(agents))
    writeFileSync(
      join(dir, 'herdr'),
      `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$1 $2" in
  "agent list") cat "${dir}/agents.json" ;;
  "pane read") echo "" ;;
  "agent rename") [ "$4" = "sol" ] && { echo "agent_name_taken" >&2; exit 1; }; exit 0 ;;
  "tab rename") exit 1 ;;
  "pane rename") exit 0 ;;
esac
`,
    )
    chmodSync(join(dir, 'herdr'), 0o755)
    const result = spawnSync('bash', ['scripts/herdr-label-models.sh', ...args, 'w'], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, HERDR_ENV: '1', HERDR_WORKSPACE_ID: 'w', ...extraEnv },
      encoding: 'utf8',
    })
    return { out: result.stdout, err: result.stderr, status: result.status, calls: readFileSync(log, 'utf8') }
  }

  it('When the name is taken and tab rename fails Then it retries with a suffix and still handles the next pane', async () => {
    const { out, err, status, calls } = await run()
    expect(status).toBe(0)
    expect(calls).toContain('agent rename w:p1 sol')
    expect(calls).toContain('agent rename w:p1 sol2')
    expect(err).toContain('탭 라벨 지정 실패')
    expect(out).toContain('w:p1 (w:t1) → sol2')
    expect(out).toContain('w:p2 (w:t2) → gemini')
  })
  it('When a pane already has a name Then it is skipped without any rename call', async () => {
    const { out, calls } = await run()
    expect(out).toContain('w:p3: 이미 이름 있음(sol), 건너뜀')
    expect(calls).not.toContain('rename w:p3')
  })
  it('When --dry-run Then nothing is renamed', async () => {
    const { out, calls } = await run({}, ['--dry-run'])
    expect(out).toContain('[dry-run] → sol')
    expect(calls).not.toContain('rename')
  })
})
