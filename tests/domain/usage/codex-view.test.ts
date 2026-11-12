import { describe, expect, it } from 'vitest'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import codexNormalRaw from '../../fixtures/codex-usage.normal.json'
import codexLimitedRaw from '../../fixtures/codex-usage.limited.json'
import codexUnknownRaw from '../../fixtures/codex-usage.unknown-keys.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

const BUILD = { now: NOW, fetchedAt: NOW_ISO } as const

describe('Given the codex normal fixture', () => {
  it('When building the view then the two windows are sorted by window length with reset wording', () => {
    const report = buildCodexUsageView(codexNormalRaw, BUILD)
    expect(report.windows.map((window) => window.id)).toEqual(['rate_limit.primary_window', 'rate_limit.secondary_window'])
    expect(report.windows[0]).toMatchObject({
      label: '5시간 한도',
      usedPercent: 20,
      status: 'normal',
      expired: false,
      resetText: '4시간 후 리셋',
    })
    expect(report.windows[1]).toMatchObject({ label: '주간 한도', usedPercent: 40, resetText: '7일 후 리셋' })
    expect(report.status).toBe('normal')
    expect(report.issues).toEqual([])
  })

  it('When some keys are not windows then meaningful metadata is retained without duplicate status fields', () => {
    const report = buildCodexUsageView(codexNormalRaw, BUILD)
    expect(report.others.map((other) => other.id)).toEqual(['plan', 'credits'])
    expect(coveredKeys(report).sort()).toEqual(Object.keys(codexNormalRaw).sort())
  })

  it('When raw is kept then the report keeps the response untouched', () => {
    const report = buildCodexUsageView(codexNormalRaw, BUILD)
    expect(report.raw).toEqual(codexNormalRaw)
  })
})

describe('Given the codex limited fixture', () => {
  it('When usage is at 100% then the cards and the report are limit', () => {
    const report = buildCodexUsageView(codexLimitedRaw, BUILD)
    expect(report.windows.map((window) => window.status)).toEqual(['limit', 'limit'])
    expect(report.status).toBe('limit')
  })

  it('When limit_reached is true then the report is limit even if every window is below 100', () => {
    const report = buildCodexUsageView(
      { rate_limit: { limit_reached: true, primary_window: { used_percent: 10, limit_window_seconds: 18000 } } },
      BUILD,
    )
    expect(report.windows[0].status).toBe('normal')
    expect(report.status).toBe('limit')
  })

  it('When a window reset already passed then it is excluded from the aggregate but keeps its badge', () => {
    const report = buildCodexUsageView(
      { rate_limit: { primary_window: { used_percent: 100, reset_at: 1794300000, limit_window_seconds: 18000 } } },
      BUILD,
    )
    expect(report.windows[0]).toMatchObject({ expired: true, status: 'limit' })
    expect(report.status).toBe('normal')
  })
})

describe('Given the codex unknown-keys fixture', () => {
  it('When windows live outside rate_limit then they become extra limit cards with readable labels', () => {
    const report = buildCodexUsageView(codexUnknownRaw, BUILD)
    expect(report.metrics.map((metric) => metric.id)).toEqual(['code_review_rate_limit', 'mcp.buckets[0]'])
    expect(report.metrics[0]).toMatchObject({ label: 'Code Review Rate Limit · 1시간 한도', unknown: true, usedPercent: 30 })
    expect(report.metrics[1]).toMatchObject({ label: 'Mcp · 5시간 한도', unknown: true, usedPercent: 5 })
  })

  it('When a window length is unverified then the label says so and reset_after_seconds resolves from fetchedAt', () => {
    const report = buildCodexUsageView(codexUnknownRaw, BUILD)
    expect(report.windows[0]).toMatchObject({ label: '3시간 한도', usedPercent: 55 })
    expect(report.windows[1]).toMatchObject({ resetsAt: '2026-11-11T12:30:00.000Z', resetText: '30분 후 리셋' })
  })

  it('When a bucket has a broken used_percent then it is reported and never becomes a card', () => {
    const report = buildCodexUsageView(codexUnknownRaw, BUILD)
    expect(report.issues).toEqual([{ code: 'invalid_utilization', key: 'broken_bucket' }])
    expect([...report.windows, ...report.metrics].map((item) => item.id)).not.toContain('broken_bucket')
  })

  it('When rendering is complete then every top level key is either a card source or an other item', () => {
    const report = buildCodexUsageView(codexUnknownRaw, BUILD)
    expect(coveredKeys(report).sort()).toEqual(Object.keys(codexUnknownRaw).sort())
    expect(report.others.map((other) => other.id)).toEqual(['plan', 'rate_limit', 'broken_bucket', 'daily'])
  })

  it('When a top level key produced windows then meaningful unknown remaining fields are kept in other items', () => {
    const report = buildCodexUsageView(codexUnknownRaw, BUILD)
    const rateLimit = report.others.find((other) => other.id === 'rate_limit')
    expect(rateLimit?.value).toEqual({
      kind: 'object',
      fields: [
        { key: 'unknown_field', text: 'kept-in-other-items' },
      ],
    })
  })
})

describe('Given a payload that is not a usage object', () => {
  it.each([null, [], 'text'])('When raw is %j then only the raw view remains', (raw) => {
    const report = buildCodexUsageView(raw, BUILD)
    expect(report).toMatchObject({ status: 'unknown', windows: [], metrics: [], others: [] })
    expect(report.raw).toBeNull()
  })
})

/** 카드의 출처가 된 최상위 키 + 기타 항목 키. */
function coveredKeys(report: ReturnType<typeof buildCodexUsageView>): string[] {
  const fromCards = [...report.windows, ...report.metrics].map((item) => item.id.split(/[.[]/)[0])
  return [...new Set([...fromCards, ...report.others.map((other) => other.id)])]
}
