import { describe, expect, it } from 'vitest'
import { decodeOffpeakSchedule, offpeakStateOf } from '@domain/usage/offpeak'
import { OFFPEAK_SCHEDULE } from '@domain/usage/offpeak-schedule'
describe('Given verified off-peak schedules', () => {
  it('When production data is decoded Then every rule is valid and sourced', () => {
    expect(decodeOffpeakSchedule(OFFPEAK_SCHEDULE).ok).toBe(true)
    expect(Object.keys(OFFPEAK_SCHEDULE).sort()).toEqual(['ollama', 'opencode'])
    for (const rule of Object.values(OFFPEAK_SCHEDULE)) {
      expect(rule.source).toMatch(/^https:/)
      expect(rule.verifiedAt).toBe('2026-11-15')
    }
  })
  it('When a weekend joins weekdays Then the whole continuous interval is returned', () => {
    expect(offpeakStateOf(OFFPEAK_SCHEDULE.opencode, new Date('2026-11-21T12:00:00Z'))).toEqual({ active: true, endsAt: '2026-11-23T01:00:00.000Z' })
    expect(offpeakStateOf(OFFPEAK_SCHEDULE.ollama, new Date('2026-11-21T12:00:00Z'))).toEqual({ active: true, endsAt: '2026-11-23T12:00:00.000Z' })
  })
})
