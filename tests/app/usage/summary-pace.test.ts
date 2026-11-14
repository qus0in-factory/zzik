import { describe, expect, it } from 'vitest'
import { summaryPaceOf } from '@app/usage/summary-pace'
import { buildOpencodeUsageView } from '@domain/usage/opencode-view'
import { buildOllamaUsageView } from '@domain/usage/ollama-view'
import { buildGrokUsageView } from '@domain/usage/grok-view'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import { buildAntigravityUsageView } from '@domain/usage/antigravity-view'
import { buildUsageView } from '@domain/usage/view'
import type { UsageWindow } from '@domain/usage/types'
import opencode from '../../fixtures/opencode-usage.normal.json'
import ollama from '../../fixtures/ollama-usage.normal.json'
import grok from '../../fixtures/grok-usage.normal.json'
import codex from '../../fixtures/codex-usage.normal.json'
import antigravity from '../../fixtures/antigravity-usage.normal.json'
import claude from '../../fixtures/claude-usage.normal.json'

const now = new Date('2026-11-11T12:00:00Z')
const DAY = 86_400

const win = (over: Partial<UsageWindow>): UsageWindow => ({
  id: 'x', label: 'x', elapsedPercent: 50, usedPercent: 10, resetsAt: null, expired: false, status: 'normal', resetText: '', cycleSeconds: 30 * DAY, ...over,
})

describe('Given the summary pace picker (가장 긴 주기 한도 하나)', () => {
  it('When a monthly window exists Then monthly wins over weekly (OpenCode 실데이터 형상)', () => {
    const report = buildOpencodeUsageView(opencode, { now })
    expect(summaryPaceOf(report.windows)).toEqual({ unit: '월', usedPercent: 10, elapsedPercent: expect.closeTo(35, 5), overPace: false })
  })
  it('When only weekly exists Then weekly (Claude 5시간 한도는 제외)', () => {
    const picked = summaryPaceOf(buildUsageView(claude, { now }).windows)
    expect(picked?.unit).toBe('주')
  })
  it('When the billing period decides the cycle Then Ollama is monthly and Grok (실데이터: 주간 결제 기간) is weekly', () => {
    expect(summaryPaceOf(buildOllamaUsageView(ollama, { now }).windows)?.unit).toBe('월')
    expect(summaryPaceOf(buildGrokUsageView(grok, { now }).windows)?.unit).toBe('주')
  })
  it('When Codex or Antigravity have a weekly window Then it is picked', () => {
    for (const windows of [buildCodexUsageView(codex, { now }).windows, buildAntigravityUsageView(antigravity, { now }).windows]) {
      const picked = summaryPaceOf(windows)
      expect(picked === null || picked.unit === '주').toBe(true)
    }
  })
  it.each([
    ['사용률이 예상보다 크면', 60, 50, true],
    ['사용률이 예상과 같으면', 50, 50, false],
    ['사용률이 예상보다 작으면', 20, 50, false],
  ])('When %s Then overPace follows used > elapsed', (_name, used, elapsed, over) => {
    expect(summaryPaceOf([win({ usedPercent: used, elapsedPercent: elapsed })])?.overPace).toBe(over)
  })
  it('When several monthly windows Then the highest used one wins', () => {
    const picked = summaryPaceOf([win({ id: 'a', usedPercent: 10 }), win({ id: 'b', usedPercent: 70 })])
    expect(picked?.usedPercent).toBe(70)
  })
  it.each([
    ['월·주 한도가 없으면', [win({ cycleSeconds: 5 * 3600 }), win({ cycleSeconds: null })]],
    ['elapsedPercent가 null이면', [win({ elapsedPercent: null })]],
    ['usedPercent가 null이면', [win({ usedPercent: null })]],
    ['창이 없으면', []],
  ])('When %s Then null (칩 생략)', (_name, windows) => {
    expect(summaryPaceOf(windows)).toBeNull()
  })
  it('When the monthly window lacks elapsedPercent but weekly has it Then null, not a fallback to weekly', () => {
    expect(summaryPaceOf([win({ elapsedPercent: null }), win({ cycleSeconds: 7 * DAY })])).toBeNull()
  })
})
