import { describe, expect, it } from 'vitest'
import { usageLabelFor } from '@domain/usage/labels'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'

const NOW = new Date('2026-11-11T12:00:00.000Z')

describe('Given a known usage key', () => {
  it.each([
    ['five_hour', '5시간 한도', false],
    ['seven_day', '주간 한도', false],
    ['seven_day_opus', 'Opus 주간', false],
    ['seven_day_sonnet', 'Sonnet 주간', false],
    ['seven_day_oauth_apps', 'OAuth 앱 주간', false],
    ['seven_day_cowork', 'Cowork 주간', false],
    ['extra_usage', '추가 사용량', false],
  ] as const)('When the key is %s then the label is %s and it is not unknown', (id, label, unknown) => {
    expect(usageLabelFor(id)).toEqual({ label, unknown })
  })
})

describe('Given an unknown usage key', () => {
  it('When the key follows the seven_day pattern then the label is derived from the slug', () => {
    expect(usageLabelFor('seven_day_haiku')).toEqual({ label: '주간 · Haiku', unknown: true })
    expect(usageLabelFor('seven_day_haiku')).toEqual({ label: '주간 · Haiku', unknown: true })
  })

  it('When the key follows the five_hour pattern then the label is derived from the slug', () => {
    expect(usageLabelFor('five_hour_gpt')).toEqual({ label: '5시간 · Gpt', unknown: true })
  })

  it('When the slug has several words then every word is capitalized', () => {
    expect(usageLabelFor('seven_day_cowork_beta').label).toBe('주간 · Cowork Beta')
  })

  it('When the key matches no pattern then the raw id is the label', () => {
    expect(usageLabelFor('thirty_day')).toEqual({ label: 'thirty_day', unknown: true })
  })

  it('When a metric id is unlisted then the report marks it unknown and a known id is not', () => {
    const report = buildUsageView(
      { seven_day_haiku: { utilization: 44, resets_at: '2026-11-15T03:00:00.000Z' }, seven_day_cowork: null },
      { now: NOW },
    )
    expect(report.metrics.find((m) => m.id === 'seven_day_haiku')).toMatchObject({ unknown: true })
    expect(report.metrics.find((m) => m.id === 'seven_day_cowork')).toMatchObject({ unknown: false })
  })
})

describe('Given the normal fixture windows', () => {
  it('When windows are labeled then the five hour window comes first with its fixed label', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    expect(report.windows.map((w) => w.label)).toEqual(['5시간 한도', '주간 한도'])
  })

  it('When validating fixture invariants then the five hour window resets within 5 hours', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    const delta = Date.parse(report.windows[0].resetsAt ?? '') - NOW.getTime()
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThan(5 * 60 * 60 * 1000)
  })
})
