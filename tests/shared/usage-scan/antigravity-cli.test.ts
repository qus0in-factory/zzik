import { describe, expect, it } from 'vitest'
import normal from '../../fixtures/antigravity-cli-quota.normal.json'
import unknown from '../../fixtures/antigravity-cli-quota.unknown.json'
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts'
import { historySample } from '../../../worker/domain/usage/history-sample'
const options = { fetchedAt: '2026-11-14T00:00:00.000Z', rawRedacted: [] as string[] }
const scan = (raw: unknown, rawRedacted: string[] = []) => scanUsageSeries('antigravity', raw, { ...options, rawRedacted })
const row = (remainingPercent: unknown, group = 'Gemini Models', label = 'Weekly Limit Remaining') => ({ group, label, remainingPercent, resetsAt: '2026-11-21T01:12:20Z' })

describe('Given Antigravity CLI history rows', () => {
  it('When the CLI fixture is scanned Then legacy ids, inverse percentages and periods are retained', () => {
    expect(scan(normal)).toEqual({ ok: true, skipped: 0, series: [
      { id: 'gemini-5h', usedPercent: 14, resetsAt: '2026-11-14T06:12:20Z', cycleSeconds: 18000 },
      { id: 'gemini-weekly', usedPercent: 4, resetsAt: '2026-11-21T01:12:20Z', cycleSeconds: 604800 },
      { id: '3p-5h', usedPercent: 0, resetsAt: '2026-11-14T07:25:12Z', cycleSeconds: 18000 },
      { id: '3p-weekly', usedPercent: 99, resetsAt: '2026-11-17T09:54:30Z', cycleSeconds: 604800 },
      { id: 'argon-weekly', usedPercent: 0, resetsAt: '2026-11-21T02:25:12Z', cycleSeconds: 604800 },
    ] })
  })
  it('When periods or groups are unknown Then synthetic ids survive and unobserved cycles are null', () => {
    const result = scan(unknown)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.series).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cli:Gemini Models:Daily Limit Remaining', usedPercent: 25, cycleSeconds: null }),
      expect.objectContaining({ id: 'cli:New Models:Trial Limit Remaining', usedPercent: 45, cycleSeconds: null }),
    ]))
    expect(scan({ source: 'agy-quota-cli', rows: [row(25, 'Future', 'Weekly Limit Remaining')] })).toMatchObject({ ok: true, series: [{ id: 'cli:Future:Weekly Limit Remaining', cycleSeconds: 604800 }] })
  })
  it('When invalid rows precede duplicates Then original row indexes determine fallback ids', () => {
    expect(scan({ source: 'agy-quota-cli', rows: [null, row(20), row(30)] })).toMatchObject({ ok: true, skipped: 1, series: [{ id: 'gemini-weekly', usedPercent: 80 }, { id: 'rows[2]', usedPercent: 70 }] })
  })
  it('When rows disappear or fail Then empty values and unknown values stay distinct', () => {
    expect(scan({ source: 'agy-quota-cli', rows: [] })).toEqual({ ok: true, skipped: 0, series: [] })
    expect(scan({ source: 'agy-quota-cli' })).toEqual({ ok: false, reason: 'invalid_shape' })
    expect(scan({ source: 'agy-quota-cli', rows: [row('bad')] })).toEqual({ ok: true, skipped: 1, series: [] })
    const sample = (rows: unknown[]) => historySample('antigravity', { id: '1', runAt: options.fetchedAt, status: 'ok', fetchedAt: options.fetchedAt, intervalSec: '900', rawText: JSON.stringify({ source: 'agy-quota-cli', rows }), rawRedacted: [] })
    expect(sample([]).values).toEqual([])
    expect(sample([row('bad')]).values).toBeNull()
  })
  it('When rows are hidden or expired Then the original CLI row paths apply before skipped accounting', () => {
    for (const path of ['rows', 'rows[0]', 'rows.0']) {
      expect(scan({ source: 'agy-quota-cli', rows: [row(10)] }, [path])).toEqual({ ok: true, skipped: 0, series: [] })
      expect(scan({ source: 'agy-quota-cli', rows: [row('bad')] }, [path])).toEqual({ ok: true, skipped: 0, series: [] })
    }
    expect(scan(normal, ['gemini-weekly'])).toMatchObject({ ok: true, series: expect.not.arrayContaining([expect.objectContaining({ id: 'gemini-weekly' })]) })
    expect(scan({ source: 'agy-quota-cli', rows: [{ ...row(5), resetsAt: '2026-11-13T00:00:00Z' }] })).toEqual({ ok: true, skipped: 0, series: [] })
  })
  it('When a group changes case or Argon labels change Then the established id mapping is reused', () => {
    expect(scan({ source: 'agy-quota-cli', rows: [row(100, ' GEMINI MODELS ', ' weekly limit remaining '), row(0, 'Gemini 4 Argon', 'Any Label')] })).toMatchObject({ ok: true, series: [{ id: 'gemini-weekly', usedPercent: 0 }, { id: 'argon-weekly', usedPercent: 100, cycleSeconds: 604800 }] })
  })
})
