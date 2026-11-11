import { describe, expect, it } from 'vitest'
import { buildCodexUsageView, buildCodexUsageView as _same } from '@domain/usage/codex-view'
import codexUsageRaw from '../../fixtures/codex-usage.normal.json'

void _same

const NOW = new Date('2026-11-11T12:00:00.000Z')
const FETCHED_AT = '2026-11-11T12:00:00.000Z'

describe('Given the Codex usage normalizer (ADR 0.3 D6)', () => {
  it('When the synthetic fixture is parsed then both rate_limit windows are the usage windows sorted by length', () => {
    const report = buildCodexUsageView(codexUsageRaw, { now: NOW, fetchedAt: FETCHED_AT })
    expect(report.windows.map((window) => window.id)).toEqual(['rate_limit.primary_window', 'rate_limit.secondary_window'])
    expect(report.windows.map((window) => window.label)).toEqual(['5시간 한도', '주간 한도'])
  })

  it('When a window carries reset_after_seconds then the reset time is computed from fetchedAt (수집 시각 기준)', () => {
    const report = buildCodexUsageView(codexUsageRaw, { now: NOW, fetchedAt: FETCHED_AT })
    const secondary = report.windows.find((window) => window.id === 'rate_limit.secondary_window')
    // fetchedAt(12:00) + 86400초
    expect(secondary?.resetsAt).toBe('2026-11-12T12:00:00.000Z')
    const primary = report.windows.find((window) => window.id === 'rate_limit.primary_window')
    // reset_at(Unix 초 1799988000)이 우선한다
    expect(primary?.resetsAt).toBe(new Date(1799988000 * 1000).toISOString())
  })

  it('When a window sits outside rate_limit and inside an array then it becomes an extra limit and stays unknown', () => {
    const report = buildCodexUsageView(codexUsageRaw, { now: NOW, fetchedAt: FETCHED_AT })
    expect(report.metrics.map((metric) => metric.id)).toEqual(['codex_extra.weekly_window', 'codes[]'])
    expect(report.metrics.every((metric) => metric.unknown === true)).toBe(true)
    expect(report.metrics[0].label).toBe('codex extra · 주간 한도')
  })

  it('When the status is aggregated then window levels decide it (limit_reached가 false인 경우)', () => {
    const report = buildCodexUsageView(codexUsageRaw, { now: NOW, fetchedAt: FETCHED_AT })
    expect(report.status).toBe('normal') // 37·62·9 모두 normal
  })

  it('When rate_limit.limit_reached is true then the report status becomes limit regardless of aggregation', () => {
    const raw = JSON.parse(JSON.stringify(codexUsageRaw)) as Record<string, unknown>
    const rateLimit = raw['rate_limit'] as Record<string, unknown>
    rateLimit['limit_reached'] = true
    const report = buildCodexUsageView(raw, { now: NOW, fetchedAt: FETCHED_AT })
    expect(report.status).toBe('limit')
  })

  it('When every top-level key must be accounted for then the completeness invariant holds (완전성 불변식)', () => {
    const report = buildCodexUsageView(codexUsageRaw, { now: NOW, fetchedAt: FETCHED_AT })
    const rendered = new Set<string>([
      ...report.windows.map((window) => window.id.split('.')[0]),
      ...report.metrics.map((metric) => metric.id.split('.')[0].replaceAll('[]', '')),
      ...report.others.map((other) => other.id.split('.')[0].replaceAll('[]', '')),
    ])
    for (const key of Object.keys(codexUsageRaw)) {
      expect(rendered.has(key)).toBe(true)
    }
    // 창을 낸 최상위 키의 창이 아닌 필드(limit_reached)도 기타 항목에 있다.
    expect(report.others.some((other) => other.id === 'rate_limit.limit_reached')).toBe(true)
  })

  it('When used_percent is malformed then it becomes an issue instead of throwing', () => {
    const raw = { rate_limit: { primary_window: { used_percent: '37', reset_at: 1799988000 } } }
    const report = buildCodexUsageView(raw, { now: NOW })
    expect(report.windows[0]?.usedPercent).toBeNull()
    expect(report.issues).toContainEqual({ code: 'invalid_utilization', key: 'rate_limit.primary_window' })
  })

  it('When the top level is not an object then only the raw view is offered', () => {
    const report = buildCodexUsageView('oops', { now: NOW })
    expect(report.status).toBe('unknown')
    expect(report.windows).toEqual([])
    expect(report.issues).toEqual([{ code: 'invalid_shape' }])
    expect(report.raw).toBeNull()
  })

  it('When a window has no known length then the path becomes the label with the unknown badge', () => {
    const raw = { rate_limit: { mystery: { used_percent: 5, reset_after_seconds: 60 } } }
    const report = buildCodexUsageView(raw, { now: NOW, fetchedAt: FETCHED_AT })
    expect(report.windows[0]).toMatchObject({ label: 'rate_limit.mystery', unknown: true })
  })
})
