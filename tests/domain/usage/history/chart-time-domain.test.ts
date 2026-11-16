import { describe, expect, it } from 'vitest'
import { chartTimeDomain, pacePoints } from '@domain/usage/history/chart-time-domain'
import { elapsedPercent } from '@domain/usage/elapsed'
import live from '../../../fixtures/usage-history/codex.xfit-live.json'

const now = Date.parse(live.now)
const day = 86_400_000
const times = live.page.samples.map(s => Date.parse(s.fetchedAt))

describe('Given actual provider collection times in the selected window', () => {
  it('When seven days are selected Then the axis starts at the first real sample and ends at now', () => {
    expect(chartTimeDomain(times, now - 7 * day, now)).toEqual({ from: times[0], to: now })
  })
  it('When 24 hours are selected Then old samples are excluded and an anchor preserves the window boundary', () => {
    expect(chartTimeDomain(times, now - day, now, times[0])).toEqual({ from: now - day, to: now })
    expect(chartTimeDomain(times, now - day, now).from).toBe(times.find(t => t >= now - day))
  })
  it('When a provider has one point or under three minutes Then the minimum width is three minutes without future time', () => {
    expect(chartTimeDomain([now], now - day, now)).toEqual({ from: now - 180_000, to: now })
    expect(chartTimeDomain([now - 60_000], now - day, now)).toEqual({ from: now - 180_000, to: now })
    expect(chartTimeDomain([], now - day, now)).toEqual({ from: now - 180_000, to: now })
    expect(chartTimeDomain([NaN, now + 1, now - 8 * day], now - day, now)).toEqual({ from: now - 180_000, to: now })
  })
  it('When providers have different first samples Then each gets its own extent', () => {
    expect(chartTimeDomain([now - 3600_000], now - 7 * day, now).from).toBe(now - 3600_000)
    expect(chartTimeDomain(times, now - 7 * day, now).from).toBe(times[0])
  })
})

describe('Given the existing elapsed-percent policy for the selected summary window', () => {
  const window = live.page.samples.at(-1)!.values![0]
  it('When the pace is drawn Then it uses elapsedPercent at the domain boundaries without extending to the future reset', () => {
    const domain = chartTimeDomain(times, now - 7 * day, now)
    const points = pacePoints(window, domain.from, domain.to)!
    expect(points[0].t).toBe(domain.from)
    expect(points.at(-1)!.t).toBe(now)
    expect(points.at(-1)!.p).toBe(elapsedPercent(window.resetsAt, window.cycleSeconds, new Date(now)))
    expect(domain.to).toBeLessThan(Date.parse(window.resetsAt!))
  })
  it('When the window starts and resets inside the domain Then 0/100 breakpoints preserve clamping', () => {
    const points = pacePoints({resetsAt: '2026-11-16T00:00:00Z', cycleSeconds: 180}, Date.parse('2026-11-15T23:55:00Z'), Date.parse('2026-11-16T00:02:00Z'))!
    expect(points.map(p => p.p)).toEqual([0, 0, 100, 100])
    expect(pacePoints({resetsAt: null, cycleSeconds: null}, now - day, now)).toBeNull()
  })
})
