import { describe, expect, it } from 'vitest'
import { decodeOffpeakSchedule, offpeakStateOf } from '@domain/usage/offpeak'
import type { OffpeakRule } from '@domain/usage/offpeak'
const state = (rule: OffpeakRule | undefined, iso: string) => offpeakStateOf(rule, new Date(iso))
describe('Given a provider off-peak rule', () => {
  const daily = { windows: [{ start: '16:30', end: '22:30' }] }
  it.each([
    ['16:29:59', false, '2026-11-16T16:30:00.000Z'],
    ['16:30:00', true, '2026-11-16T22:30:00.000Z'],
    ['22:29:59', true, '2026-11-16T22:30:00.000Z'],
    ['22:30:00', false, '2026-11-17T16:30:00.000Z'],
  ])('When now is %s Then inclusive start and exclusive end apply', (time, active, at) => {
    expect(state(daily, `2026-11-16T${time}Z`)).toEqual(active ? { active, endsAt: at } : { active, startsAt: at })
  })
  it('When a window crosses midnight Then the previous start day applies', () => {
    const rule = { windows: [{ start: '22:00', end: '06:00', days: [5] }] }
    expect(state(rule, '2026-11-20T23:00:00Z')).toEqual({ active: true, endsAt: '2026-11-21T06:00:00.000Z' })
    expect(state(rule, '2026-11-21T03:00:00Z')).toEqual({ active: true, endsAt: '2026-11-21T06:00:00.000Z' })
    expect(state(rule, '2026-11-21T06:00:00Z')).toEqual({ active: false, startsAt: '2026-11-27T22:00:00.000Z' })
    expect(state(rule, '2026-11-22T03:00:00Z')?.active).toBe(false)
  })
  it('When weekend windows touch Then their end is merged', () => {
    const rule = { windows: [{ start: '00:00', end: '24:00', days: [6, 0] }] }
    expect(state(rule, '2026-11-20T23:59:00Z')).toEqual({ active: false, startsAt: '2026-11-21T00:00:00.000Z' })
    expect(state(rule, '2026-11-21T12:00:00Z')).toEqual({ active: true, endsAt: '2026-11-23T00:00:00.000Z' })
    expect(state(rule, '2026-11-23T00:00:00Z')).toEqual({ active: false, startsAt: '2026-11-28T00:00:00.000Z' })
  })
  it('When windows overlap Then their union ends at the last end', () => {
    expect(state({ windows: [{ start: '12:00', end: '16:00' }, { start: '14:00', end: '18:00' }] }, '2026-11-16T13:00:00Z')).toEqual({ active: true, endsAt: '2026-11-16T18:00:00.000Z' })
  })
  it('When input is missing or malformed Then it returns null or ignores invalid windows without throwing', () => {
    for (const rule of [undefined, { windows: [] }, null, {}, { windows: null }, { windows: [null, { start: '25:00', end: '26:00' }] }]) {
      expect(state(rule as OffpeakRule, '2026-11-16T12:00:00Z')).toBeNull()
    }
    expect(state(daily, 'invalid')).toBeNull()
    expect(offpeakStateOf(daily, new Date(8_640_000_000_000_000))).toBeNull()
    expect(state({ windows: [{ start: '25:00', end: '26:00' }, ...daily.windows] }, '2026-11-16T17:00:00Z')?.active).toBe(true)
  })
})
describe('Given injected schedule data', () => {
  it('When all data is valid Then decoding succeeds', () => {
    const schedule = { opencode: { windows: [{ start: '22:00', end: '06:00', days: [5] }], source: 'https://example.com', verifiedAt: '2026-11-15' } }
    expect(decodeOffpeakSchedule(schedule)).toEqual({ ok: true, schedule })
    expect(decodeOffpeakSchedule({})).toEqual({ ok: true, schedule: {} })
  })
  it.each([null, [], 1, 'text', { opencode: null }, { opencode: { windows: 'bad' } }, { opencode: { windows: [], source: 1 } }, { opencode: { windows: [], verifiedAt: '2026-02-30' } }])('When shape is invalid Then decoding reports a path', value => {
    expect(decodeOffpeakSchedule(value)).toMatchObject({ ok: false, reason: 'invalid_shape', path: expect.any(String) })
  })
  it('When provider is unknown Then it is rejected', () => {
    expect(decodeOffpeakSchedule({ unknown: { windows: [] } })).toEqual({ ok: false, reason: 'unknown_provider', path: 'unknown' })
  })
  it.each([
    { start: '25:00', end: '26:00' }, { start: '24:00', end: '06:00' },
    { start: '12:00', end: '00:00' }, { start: '12:00', end: '12:00' },
    { start: '12:00', end: '18:00', days: [7] }, { start: '12:00', end: '18:00', days: [1.5] },
    { start: '1:00', end: '18:00' }, null,
  ])('When a window is invalid Then its path identifies it', window => {
    expect(decodeOffpeakSchedule({ opencode: { windows: [window] } })).toEqual({ ok: false, reason: 'invalid_window', path: 'opencode.windows[0]' })
  })
})
