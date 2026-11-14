import { describe, expect, it } from 'vitest'
import { diffAlerts, nextAlertState } from '../../../../collector/app/usage/diff-alerts.mjs'
import { buildAlertReport } from '../../../../collector/domain/usage/alert-report.mjs'
const nowMs = Date.parse('2026-11-14T00:00:00Z')
const limit = (usedPercent = 10, id = 'five_hour', elapsedPercent = 50) => ({ id, label: id, usedPercent, elapsedPercent, resetsAt: '2026-11-14T02:30:00Z', cycleSeconds: 18000, expired: false })
const report = (limits = [limit()], time = nowMs, primaryId: string | null = null) => ({ provider: 'claude', nowMs: time, limits, primaryId })
const baseline = (r = report()) => nextAlertState(null, r, [])
const step = (state: ReturnType<typeof baseline>, r: ReturnType<typeof report>) => { const events = diffAlerts(state, r); return { events, state: nextAlertState(state, r, events) } }

describe('Given a persisted alert baseline', () => {
  it('When this is the first report Then establishes a baseline without alerts', () => {
    const r = report([limit(95)])
    expect(diffAlerts(null, r)).toEqual([])
    expect(diffAlerts(baseline(r), r)).toEqual([])
  })
  it.each([[75, 'caution'], [95, 'danger'], [100, 'limit']] as const)('When used becomes %s Then reports %s entry including five-hour windows', (used, to) => {
    expect(diffAlerts(baseline(), report([limit(used)]))).toMatchObject([{ kind: 'level', from: 'normal', to, id: 'five_hour' }])
  })
  it('When caution worsens Then danger and limit bypass the flap cooldown', () => {
    let s = step(baseline(), report([limit(75)]))
    s = step(s.state, report([limit(95)], nowMs + 60_000))
    expect(s.events).toMatchObject([{ from: 'caution', to: 'danger' }])
    expect(diffAlerts(s.state, report([limit(100)], nowMs + 120_000))).toMatchObject([{ from: 'danger', to: 'limit' }])
  })
  it('When an alert clears after cooldown Then reports recovery only once, including after restart', () => {
    const s = step(baseline(), report([limit(95)]))
    const cleared = step(s.state, report([limit(10)], nowMs + 1_800_000))
    expect(cleared.events).toMatchObject([{ from: 'danger', to: 'normal' }])
    expect(diffAlerts(JSON.parse(JSON.stringify(cleared.state)), report([limit(10)], nowMs + 2_700_000))).toEqual([])
  })
  it('When entry and clearing flap within 30 minutes Then suppresses repeats and emits a sustained clear later', () => {
    const s = step(baseline(), report([limit(75)]))
    const clear = step(s.state, report([limit(10)], nowMs + 900_000))
    expect(clear.events).toEqual([])
    expect(diffAlerts(clear.state, report([limit(75)], nowMs + 1_200_000))).toEqual([])
    expect(diffAlerts(clear.state, report([limit(10)], nowMs + 1_800_000))).toMatchObject([{ to: 'normal' }])
  })
  it('When a cleared window reenters quickly Then suppresses the entry until cooldown ends', () => {
    const s = step(baseline(report([limit(90)])), report([limit(10)], nowMs + 1_800_000))
    const again = step(s.state, report([limit(75)], nowMs + 2_000_000))
    expect(again.events).toEqual([])
    expect(diffAlerts(again.state, report([limit(75)], nowMs + 3_600_000))).toMatchObject([{ to: 'caution' }])
  })
  it('When an expired positive value or missing window appears Then does not falsely clear an alert', () => {
    const s = baseline(report([limit(95)]))
    expect(diffAlerts(s, report([{ ...limit(95), expired: true, elapsedPercent: 100 }], nowMs + 9_000_000))).toEqual([])
    expect(diffAlerts(s, report([], nowMs + 9_000_000))).toEqual([])
  })
  it('When a previously unseen window enters caution after baseline Then alerts without losing other windows', () => {
    expect(diffAlerts(baseline(), report([limit(), limit(75, 'seven_day')]))).toMatchObject([{ id: 'seven_day' }])
  })
})

describe('Given the primary monthly or weekly reset', () => {
  const weekly = { ...limit(95, 'seven_day'), cycleSeconds: 604800, resetsAt: new Date(nowMs + 1000).toISOString() }
  it('When reset time passes and use drops exactly to zero Then reports reset once', () => {
    const before = baseline(report([weekly], nowMs, weekly.id))
    const r = report([{ ...weekly, usedPercent: 0, elapsedPercent: 0, resetsAt: new Date(nowMs + 604_801_000).toISOString() }], nowMs + 1000, weekly.id)
    const s = step(before, r)
    expect(s.events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reset', id: 'seven_day', usedPercent: 0 })]))
    expect(diffAlerts(s.state, { ...r, nowMs: nowMs + 900_000 })).toEqual([])
  })
  it('When the reset also clears danger Then one reset event covers recovery without a delayed duplicate', () => {
    const before = baseline(report([weekly], nowMs, weekly.id))
    const r = report([{ ...weekly, usedPercent: 0, resetsAt: new Date(nowMs + 604_801_000).toISOString() }], nowMs + 2_000_000, weekly.id)
    const s = step(before, r)
    expect(s.events).toHaveLength(1)
    expect(s.events[0].kind).toBe('reset')
    expect(diffAlerts(s.state, { ...r, nowMs: nowMs + 4_000_000 })).toEqual([])
  })
  it('When a primary is briefly missing Then its earlier reset checkpoint survives until reappearance', () => {
    const before = baseline(report([weekly], nowMs, weekly.id))
    const gap = nextAlertState(before, report([], nowMs + 500, null), [])
    const r = report([{ ...weekly, usedPercent: 0 }], nowMs + 1000, weekly.id)
    expect(diffAlerts(gap, r)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reset' })]))
  })
  it('When zero occurs before reset, nonzero falls, or a non-primary window resets Then no reset event', () => {
    const before = baseline(report([weekly], nowMs, weekly.id))
    for (const r of [report([{ ...weekly, usedPercent: 0 }], nowMs, weekly.id), report([{ ...weekly, usedPercent: 1 }], nowMs + 1000, weekly.id), report([{ ...weekly, usedPercent: 0 }], nowMs + 1000, null)]) expect(diffAlerts(before, r).filter(e => e.kind === 'reset')).toEqual([])
  })
  it('When a 5h window resets Then it can recover but is not a primary reset alert', () => {
    const before = baseline(report([limit(95)]))
    expect(diffAlerts(before, report([limit(0)], nowMs + 10_000_000)).filter(e => e.kind === 'reset')).toEqual([])
  })
  it('When primary use drops to zero but its next reset is still expired Then reset remains detectable', () => {
    const before = baseline(report([weekly], nowMs, weekly.id))
    expect(diffAlerts(before, report([{ ...weekly, usedPercent: 0, expired: true }], nowMs + 1000, weekly.id))).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'reset' })]))
  })
})

describe('Given a raw provider report', () => {
  it('When Claude scoped metrics are more used Then primary remains the all-model weekly window', () => {
    const r = buildAlertReport('claude', JSON.stringify({ seven_day: { utilization: 10 }, seven_day_fable: { utilization: 95 } }), nowMs, [])
    expect(r?.primaryId).toBe('seven_day')
    expect(r?.limits.map(w => w.id)).toEqual(['seven_day', 'seven_day_fable'])
  })
  it('When Codex only gives reset_after_seconds Then pace uses this successful observation time', () => {
    const r = buildAlertReport('codex', JSON.stringify({rate_limit:{primary_window:{used_percent:75,limit_window_seconds:18000,reset_after_seconds:9000}}}), nowMs, [])
    expect(r?.limits[0]).toMatchObject({resetsAt:'2026-11-14T02:30:00.000Z',elapsedPercent:50})
  })
  it('When a Codex metric is more used Then the primary remains a rate_limit window', () => {
    const r = buildAlertReport('codex', JSON.stringify({rate_limit:{primary_window:{used_percent:10,limit_window_seconds:604800}},code_review_rate_limit:{used_percent:95,limit_window_seconds:604800}}), nowMs, [])
    expect(r?.primaryId).toBe('rate_limit.primary_window')
  })
  it('When monthly and weekly coexist Then monthly wins; Antigravity only follows Gemini weekly', () => {
    const oc = buildAlertReport('opencode', JSON.stringify({usage:{weekly:{percent:95,resetsAt:'2026-11-21T00:00:00Z'},monthly:{percent:10,resetsAt:'2026-12-01T00:00:00Z'}}}), nowMs, [])
    expect(oc?.primaryId).toBe('monthly')
    const agy = buildAlertReport('antigravity', JSON.stringify({source:'agy-quota-cli',rows:[{group:'Gemini Models',label:'Weekly Limit Remaining',remainingPercent:90},{group:'Gemini 4 Argon',label:'Weekly Limit Remaining',remainingPercent:0}]}), nowMs, [])
    expect(agy?.primaryId).toBe('gemini-weekly')
  })
  it('When the raw body is corrupt Then it does not manufacture a recovery', () => {
    expect(buildAlertReport('claude', 'bad', nowMs, [])).toBeNull()
    expect(buildAlertReport('antigravity', '{}', nowMs, [])).toBeNull()
  })
})
