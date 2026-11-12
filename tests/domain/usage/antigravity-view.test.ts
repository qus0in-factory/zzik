import { describe, it, expect } from 'vitest'
import { buildAntigravityUsageView } from '@domain/usage/antigravity-view'
import normal from '../../fixtures/antigravity-usage.normal.json'
import limited from '../../fixtures/antigravity-usage.limited.json'
import unknown from '../../fixtures/antigravity-usage.unknown-keys.json'
const now = new Date('2026-11-11T12:00:00Z')
describe('Given synthetic values on the masked probe shape; separate from the captured live fixture', () => {
  it('When normal Then orders group windows by duration and computes usage and elapsed', () => {
    const report=buildAntigravityUsageView(normal,{now})
    expect(report.windows.map(w=>w.id)).toEqual(['3p-5h','3p-weekly'])
    expect(report.windows[0].usedPercent).toBeCloseTo(35)
    expect(report.windows[0].elapsedPercent).toBe(50)
    expect(report.windows[1].usedPercent).toBeCloseTo(12)
    expect(report.metrics).toEqual([])
    expect(report.others.map(o=>o.id)).toEqual(['description'])
    expect(report.raw).toEqual(normal)
    expect(report.status).toBe('normal')
  })
  it('When limited Then aggregates unexpired limits', () => {
    expect(buildAntigravityUsageView(limited,{now}).status).toBe('limit')
    expect(buildAntigravityUsageView(limited,{now:new Date('2026-11-12T00:00:00Z')}).status).toBe('normal')
  })
  it('When unknown Then retains valid buckets and metadata and reports bad usage', () => {
    const report=buildAntigravityUsageView(unknown,{now})
    expect(report.windows.map(w=>w.id)).toEqual(['3p-5h','3p-weekly','gemini-weekly','groups[1].buckets[1]'])
    expect(report.windows[3]).toMatchObject({unknown:true,elapsedPercent:null})
    expect(report.issues).toEqual([{code:'invalid_utilization',key:'groups[1].buckets[2]'}])
    expect(report.others.map(o=>o.id)).toEqual(['description','unknown_field'])
  })
})

describe('Given Antigravity fixture dates', () => {
  it('When rebased Then shifts resetTime without mutating the fixture', async () => {
    const { rebaseAntigravityResetsAt } = await import('@domain/usage/antigravity-calibration')
    const shifted = rebaseAntigravityResetsAt(normal, now, new Date(now.getTime()+86400000))
    const report = buildAntigravityUsageView(shifted,{now:new Date(now.getTime()+86400000)})
    expect(report.windows[0].elapsedPercent).toBe(50)
    expect(normal.groups[0].buckets[1].resetTime).toBe('2026-11-11T14:30:00Z')
  })
})

describe('Given the Gemini, Claude·GPT and Argon groups', () => {
  it('When all three groups exist Then five cards with short group labels in group order', async () => {
    const { default: geminiArgon } = await import('../../fixtures/antigravity-usage.gemini-argon.json')
    const report = buildAntigravityUsageView(geminiArgon, { now })
    expect(report.windows.map(w => [w.id, w.label, Math.round(w.usedPercent ?? -1)])).toEqual([
      ['gemini-5h', 'Gemini · 5시간 한도', 13],
      ['gemini-weekly', 'Gemini · 주간 한도', 87],
      ['3p-5h', 'Claude·GPT · 5시간 한도', 0],
      ['3p-weekly', 'Claude·GPT · 주간 한도', 99],
      ['argon-weekly', 'Argon · 주간 한도', 100],
    ])
    expect(report.status).toBe('limit')
    expect(report.issues).toEqual([])
  })
  it('When the group name is unknown Then it is shown as is', async () => {
    const { antigravityGroupLabel } = await import('@domain/usage/antigravity-labels')
    expect(antigravityGroupLabel('Future Models')).toBe('Future Models')
    expect(antigravityGroupLabel('GEMINI MODELS')).toBe('Gemini')
  })
})
