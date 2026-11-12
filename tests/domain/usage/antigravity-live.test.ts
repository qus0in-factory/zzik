import { describe, it, expect } from 'vitest'
import { buildAntigravityUsageView } from '@domain/usage/antigravity-view'
import { buildProviderUsageView } from '@domain/usage/providers'
import live from '../../fixtures/antigravity-usage.live.json'

describe('Given masked Antigravity response from the authorized UA dry-run', () => {
  const now = new Date('2026-11-13T00:51:42Z')
  it('When normalized Then each live bucket appears once and maps its real window and utilization', () => {
    const report = buildAntigravityUsageView(live, { now })
    expect(live.groups).toHaveLength(1)
    expect(report.windows).toHaveLength(live.groups.flatMap(group => group.buckets).length)
    expect(report.windows.map(window => window.id)).toEqual(['masked-bucket-2', 'masked-bucket-1'])
    expect(new Set(report.windows.map(window => window.id)).size).toBe(2)
    expect(report.windows[0]).toMatchObject({
      label: 'Masked model group · 5시간 한도', usedPercent: 0,
      resetsAt: '2026-11-13T03:21:42Z', elapsedPercent: 50, unknown: false,
    })
    expect(report.windows[1].usedPercent).toBeCloseTo(99.4456, 8)
    expect(report.windows[1].resetsAt).toBe('2026-11-17T09:54:30Z')
    const expectedElapsed = (1 - (Date.parse(live.groups[0].buckets[0].resetTime) - now.getTime()) / 604800000) * 100
    expect(report.windows[1].elapsedPercent).toBeCloseTo(expectedElapsed, 8)
    expect(report.status).toBe('warn')
    expect(report.metrics).toEqual([])
    expect(report.others).toEqual([])
    expect(report.issues).toEqual([])
    expect(report.raw).toEqual(live)
  })
  it('When selected through the provider registry Then uses the same live normalization', () => {
    expect(buildProviderUsageView('antigravity', live, { now })).toEqual(buildAntigravityUsageView(live, { now }))
  })
  it('When the fixture is inspected Then only masked strings or approved technical window/date fields remain', () => {
    const walk = (value: unknown, key = ''): void => {
      if (Array.isArray(value)) { value.forEach(item => walk(item, key)); return }
      if (value !== null && typeof value === 'object') { Object.entries(value).forEach(([key,item]) => walk(item,key)); return }
      if (typeof value !== 'string') return
      if (key === 'bucketId') expect(value).toMatch(/^masked-bucket-\d+$/)
      else if (key === 'displayName') expect(value).toBe('Masked model group')
      else if (key === 'window') expect(['5h','weekly']).toContain(value)
      else if (key === 'resetTime') expect(Number.isFinite(Date.parse(value))).toBe(true)
      else expect(value).toBe('[가림]')
    }
    walk(live)
  })
})
