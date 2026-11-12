import { describe, expect, it } from 'vitest'
import { buildProviderUsageView, isUsageProvider, USAGE_PROVIDER_META, USAGE_PROVIDERS } from '@domain/usage/providers'
import codexNormalRaw from '../../fixtures/codex-usage.normal.json'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { NOW } from '../../fakes/usage-ports'

describe('Given the provider registry (D8)', () => {
  it('When listing providers then claude comes before codex, then antigravity, opencode, grok and ollama', () => {
    expect(USAGE_PROVIDERS).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
  })

  it.each([
    ['claude', true],
    ['codex', true],
    ['antigravity', true],
    ['opencode', true],
    ['grok', true],
    ['ollama', true],
    ['xai', false],
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

describe('Given Antigravity registration', () => {
  it('When selected Then uses bucket normalization and its own metadata', () => {
    const report=buildProviderUsageView('antigravity', {groups:[{buckets:[{bucketId:'safe',window:'5h',remainingFraction:0.5}]}]}, {now:NOW})
    expect(report.windows[0]).toMatchObject({id:'safe',usedPercent:50})
    expect(USAGE_PROVIDER_META.antigravity).toMatchObject({title:'Antigravity',clientName:'Antigravity',sectionId:'usage-antigravity'})
  })
})

describe('Given OpenCode, Grok and Ollama registration', () => {
  it('When reading the metadata Then titles, client names and section ids follow the design', () => {
    expect(USAGE_PROVIDER_META.opencode).toMatchObject({ title: 'OpenCode', clientName: 'OpenCode', sectionId: 'usage-opencode', ariaLabel: 'OpenCode 사용량' })
    expect(USAGE_PROVIDER_META.grok).toMatchObject({ title: 'Grok', clientName: 'OpenCode(xAI 로그인)', sectionId: 'usage-grok', ariaLabel: 'Grok 사용량' })
    expect(USAGE_PROVIDER_META.ollama).toMatchObject({ title: 'Ollama', clientName: 'Ollama', sectionId: 'usage-ollama', ariaLabel: 'Ollama 사용량' })
  })
  it('When checking networkErrorNote Then only ollama has one', () => {
    expect(USAGE_PROVIDERS.filter((id) => USAGE_PROVIDER_META[id].networkErrorNote !== undefined)).toEqual(['ollama'])
  })
  it.each(['opencode', 'grok', 'ollama'] as const)('When %s is selected Then its own normalizer runs, not the claude one', (provider) => {
    expect(buildProviderUsageView(provider, null, { now: NOW }).issues).toEqual([{ code: 'invalid_shape' }])
  })
})
