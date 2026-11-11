import { describe, expect, it } from 'vitest'
import { buildProviderUsageView, isUsageProvider, USAGE_PROVIDER_META, USAGE_PROVIDERS } from '@domain/usage/providers'
import codexNormalRaw from '../../fixtures/codex-usage.normal.json'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { NOW } from '../../fakes/usage-ports'

describe('Given the provider registry (D8)', () => {
  it('When listing providers then claude comes before codex and only those two exist', () => {
    expect(USAGE_PROVIDERS).toEqual(['claude', 'codex'])
  })

  it.each([
    ['claude', true],
    ['codex', true],
    ['nope', false],
    ['', false],
    [undefined, false],
    ['__proto__', false],
    [0, false],
  ] as const)('When the value is %j then isUsageProvider is %s', (value, expected) => {
    expect(isUsageProvider(value)).toBe(expected)
  })

  it('When reading the metadata then titles, hints and section ids follow the ADR table', () => {
    expect(USAGE_PROVIDER_META.claude).toMatchObject({
      id: 'claude',
      title: 'Claude',
      metricsTitle: '모델·기능별 한도',
      refreshHint: '이 Mac에서 Claude Code를 실행하면 갱신된다',
      sectionId: 'usage-claude',
      ariaLabel: 'Claude 사용량',
    })
    expect(USAGE_PROVIDER_META.codex).toMatchObject({
      id: 'codex',
      title: 'ChatGPT (Codex)',
      metricsTitle: '추가 한도',
      refreshHint: '이 Mac에서 Codex를 실행하면 갱신된다',
      sectionId: 'usage-codex',
      ariaLabel: 'ChatGPT 사용량',
    })
  })
})

describe('Given the per-provider view builder', () => {
  it('When building the claude view then the claude normalizer runs', () => {
    const report = buildProviderUsageView('claude', normalRaw, { now: NOW })
    expect(report.windows.map((window) => window.id)).toEqual(['five_hour', 'seven_day'])
  })

  it('When building the codex view then nested windows become codex cards', () => {
    const report = buildProviderUsageView('codex', codexNormalRaw, { now: NOW, fetchedAt: '2026-11-11T12:00:00.000Z' })
    expect(report.windows.map((window) => window.id)).toEqual(['rate_limit.primary_window', 'rate_limit.secondary_window'])
    expect(report.windows[0]).toMatchObject({ label: '5시간 한도', usedPercent: 20 })
  })

  it('When the raw payload is empty then each provider still yields a shaped report', () => {
    expect(buildProviderUsageView('claude', null, { now: NOW })).toMatchObject({ status: 'unknown', windows: [], metrics: [] })
    expect(buildProviderUsageView('codex', null, { now: NOW })).toMatchObject({ status: 'unknown', windows: [], metrics: [] })
  })
})
