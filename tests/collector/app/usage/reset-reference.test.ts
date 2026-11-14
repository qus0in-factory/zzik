import { describe, expect, it } from 'vitest'
import { diffAlerts, nextAlertState } from '../../../../collector/app/usage/diff-alerts.mjs'
import { barLevelOf, getUsageStatus } from '../../../../shared/usage-policy'
import type { AlertReport, AlertState } from '../../../../collector/domain/usage/alert-types.mjs'

const start = Date.parse('2026-11-14T00:00:00Z')
const minute = 60_000
function report(used: number, at: number, reset: number, weekly = true, expired = false): AlertReport {
  const id = weekly ? 'seven_day' : 'five_hour'
  return { provider: 'claude', nowMs: start + at * minute, primaryId: weekly ? id : null,
    limits: [{ id, label: id, usedPercent: used, elapsedPercent: 42.4,
      cycleSeconds: weekly ? 604800 : 18000, resetsAt: new Date(start + reset * minute).toISOString(), expired }] }
}
function step(state: AlertState, next: AlertReport) {
  const events = diffAlerts(state, next)
  // Recovery notifications must agree with the current alert level, not an obsolete reference.
  for (const event of events.filter(e => e.to === 'normal' && e.kind === 'level')) {
    expect(getUsageStatus(event.usedPercent!)).not.toBe('limit')
    expect(barLevelOf(event.usedPercent, event.elapsedPercent)).not.toBe('danger')
    expect(event.usedPercent! < 25 || barLevelOf(event.usedPercent, event.elapsedPercent) !== 'caution').toBe(true)
  }
  return { events, state: nextAlertState(state, next, events) }
}
function baseline(used = 80, reset = 2880, weekly = true) {
  return nextAlertState(null, report(used, 0, reset, weekly), [])
}

describe('Given an early zero outside the two-poll reset tolerance', () => {
  it('When E1 weekly usage grows after a zero two days early Then the old boundary invents no reset or recovery', () => {
    let state = baseline()
    for (const [used, at] of [[0, 15], [30, 60], [50, 120]] as const) {
      state = step(state, report(used, at, 10080)).state
    }
    const last = step(state, report(55, 2895, 10080))
    expect(last.events).toEqual([])
    expect(last.state.windows.seven_day.notifiedLevel).toBe('caution')
    expect(last.state.windows.seven_day.resetReference).toBeUndefined()
    expect(step(last.state, report(55, 2910, 10080)).events).toEqual([])
  })
  it('When E2 five-hour use returns to danger after a zero 45 minutes early Then the old boundary causes no false recovery', () => {
    const early = step(baseline(95, 60, false), report(0, 15, 315, false))
    const growing = step(early.state, report(92, 45, 315, false))
    const last = step(growing.state, report(93, 61, 315, false))
    expect(last.events).toEqual([])
    expect(last.state.windows.five_hour.notifiedLevel).toBe('danger')
    expect(step(last.state, report(93, 76, 315, false)).events).toEqual([])
  })
})

describe('Given a zero within the reset tolerance', () => {
  it.each([[30, true], [29.999, false]] as const)('When observed at minute %s before R=60 Then bounds reference creation', (at, kept) => {
    const next = step(baseline(80, 60), report(0, at, 10080)).state
    expect(Boolean(next.windows.seven_day.resetReference)).toBe(kept)
  })
  it('When the first post-boundary value exceeds the reference Then discards it and later declines cause no reset', () => {
    const early = step(baseline(80, 60), report(0, 45, 10080))
    const first = step(early.state, report(85, 61, 10080))
    expect(first.state.windows.seven_day.resetReference).toBeUndefined()
    expect(step(first.state, report(83, 91, 10080)).events.filter(e => e.kind === 'reset')).toEqual([])
  })
  it('When usage exceeds the reference before R Then never raises that reference', () => {
    const early = step(baseline(80, 60), report(0, 45, 10080))
    const higher = step(early.state, report(85, 50, 10080))
    expect(higher.state.windows.seven_day.resetReference?.usedPercent).toBe(80)
    const after = step(higher.state, report(83, 61, 10080))
    expect(after.events.filter(e => e.kind === 'reset')).toEqual([])
    expect(after.state.windows.seven_day.resetReference).toBeUndefined()
  })
  it('When the first post-boundary value is expired positive Then preserves evidence only until the next valid observation', () => {
    const early = step(baseline(80, 60), report(0, 45, 10080))
    const stale = step(early.state, report(85, 61, 60, true, true))
    expect(stale.state.windows.seven_day.resetReference).toEqual(early.state.windows.seven_day.resetReference)
    const fresh = step(stale.state, report(85, 76, 10080))
    expect(fresh.state.windows.seven_day.resetReference).toBeUndefined()
  })
  it.each(['broken', { usedPercent: -1, resetsAt: 'bad' }, { usedPercent: 80, resetsAt: 'bad' }])(
    'When a saved reference is malformed Then never persists it even while the window is stale or absent', malformed => {
      const state = baseline(80, 60)
      state.windows.seven_day.resetReference = malformed as never
      for (const r of [report(85, 61, 60, true, true), { ...report(0, 61, 10080), limits: [] }, report(85, 61, 10080)]) {
        expect(nextAlertState(state, r, []).windows.seven_day.resetReference).toBeUndefined()
      }
    })
})
