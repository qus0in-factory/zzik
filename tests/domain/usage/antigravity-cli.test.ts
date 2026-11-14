import { describe, expect, it } from 'vitest'
import normal from '../../fixtures/antigravity-cli-quota.normal.json'
import unknown from '../../fixtures/antigravity-cli-quota.unknown.json'
import apiShape from '../../fixtures/antigravity-usage.gemini-argon.json'
import { scanAntigravityBuckets, antigravityCliBucket } from '@domain/usage/antigravity-buckets'
import { buildAntigravityUsageView } from '@domain/usage/antigravity-view'

describe('Given the agy /quota raw shape (ADR 0.4 0.6 변경)', () => {
  it('When the CLI rows are scanned Then the five known windows keep their dashboard ids and windows', () => {
    const { buckets, issues } = scanAntigravityBuckets(normal)
    expect(issues).toEqual([])
    expect(buckets.map((bucket) => bucket.id)).toEqual(['gemini-weekly', 'gemini-5h', '3p-weekly', '3p-5h', 'argon-weekly'])
    expect(buckets.map((bucket) => bucket.window)).toEqual(['weekly', '5h', 'weekly', '5h', 'weekly'])
    expect(buckets.map((bucket) => bucket.usedPercent)).toEqual([4, 14, 99, 0, 0])
    expect(buckets[0]).toMatchObject({
      groupLabel: 'Gemini Models',
      resetsAt: '2026-11-21T01:12:20Z',
    })
    expect(buckets[4]).toMatchObject({ groupLabel: 'Gemini 4 Argon', usedPercent: 0 })
  })

  it('When a group is unknown Then its raw label is kept and the id is synthesized', () => {
    const { buckets } = scanAntigravityBuckets(unknown)
    expect(buckets.map((bucket) => bucket.groupLabel)).toEqual(['Gemini Models', 'Gemini Models', 'New Models'])
    expect(buckets[1]).toMatchObject({ id: 'cli:Gemini Models:Daily Limit Remaining', window: '알 수 없는', usedPercent: 25 })
    expect(buckets[2]).toMatchObject({ id: 'cli:New Models:Trial Limit Remaining', window: '알 수 없는', usedPercent: 45 })
  })

  it('When rows are malformed Then only the broken rows are reported as issues', () => {
    const raw = {
      source: 'agy-quota-cli',
      rows: [null, { group: '', label: 'L', remainingPercent: 1, resetsAt: null }, { group: 'G', label: 'L', remainingPercent: -1, resetsAt: null }, { group: 'G', label: 'L', remainingPercent: 25, resetsAt: 'bad' }],
    }
    const { buckets, issues } = scanAntigravityBuckets(raw)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]).toMatchObject({ id: 'cli:G:L', usedPercent: 75, resetsAt: null })
    expect(issues).toEqual([
      { code: 'invalid_entry', key: 'rows[0]' },
      { code: 'invalid_entry', key: 'rows[1]' },
      { code: 'invalid_utilization', key: 'rows[2]' },
    ])
  })

  it('When the old API envelope is scanned Then the existing ids still come out (이력 호환)', () => {
    const { buckets } = scanAntigravityBuckets(apiShape)
    expect(buckets.map((bucket) => bucket.id)).toEqual(['gemini-weekly', 'gemini-5h', '3p-weekly', '3p-5h', 'argon-weekly'])
  })

  it('When mapping a known group/label Then the legacy bucket id and window are used', () => {
    expect(antigravityCliBucket('Gemini Models', 'Weekly Limit Remaining')).toEqual({ id: 'gemini-weekly', window: 'weekly' })
    expect(antigravityCliBucket('Claude and GPT models', 'Five Hour Limit Remaining')).toEqual({ id: '3p-5h', window: '5h' })
    expect(antigravityCliBucket('Gemini 4 Argon', 'Any Label')).toEqual({ id: 'argon-weekly', window: 'weekly' })
  })

  it('When source is the CLI but rows are missing Then it is an invalid shape, not an empty chart', () => {
    expect(scanAntigravityBuckets({ source: 'agy-quota-cli' })).toEqual({ buckets: [], issues: [{ code: 'invalid_shape' }] })
  })

  it('When the view is built Then the known group labels and periods are reused', () => {
    const report = buildAntigravityUsageView(normal, { now: new Date('2026-11-14T00:00:00Z') })
    expect(report.windows.map((window) => window.id)).toEqual(['gemini-5h', 'gemini-weekly', '3p-5h', '3p-weekly', 'argon-weekly'])
    expect(report.windows.map((window) => window.label)).toEqual([
      'Gemini · 5시간 한도',
      'Gemini · 주간 한도',
      'Claude·GPT · 5시간 한도',
      'Claude·GPT · 주간 한도',
      'Argon · 주간 한도',
    ])
    expect(report.windows.map((window) => window.cycleSeconds)).toEqual([18000, 604800, 18000, 604800, 604800])
    expect(report.others).toEqual([])
  })
})
