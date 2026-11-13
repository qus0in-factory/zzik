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
