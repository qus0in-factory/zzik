import { describe, expect, it } from 'vitest'
import { decodeOffpeakSchedule, offpeakStateOf } from '@domain/usage/offpeak'
import { OFFPEAK_SCHEDULE } from '@domain/usage/offpeak-schedule'
describe('Given verified off-peak schedules', () => {
  it('When production data is decoded Then every rule is valid and sourced', () => {
    expect(decodeOffpeakSchedule(OFFPEAK_SCHEDULE).ok).toBe(true)
    expect(Object.keys(OFFPEAK_SCHEDULE).sort()).toEqual(['ollama', 'opencode'])
    for (const rule of Object.values(OFFPEAK_SCHEDULE)) {
      expect(rule.source).toMatch(/^https:/)
      expect(rule.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(rule.effect).toEqual({ target: 'DeepSeek', discountPercent: 50 })
    }
  })
  it('When a weekend joins weekdays Then the whole continuous interval is returned', () => {
    expect(offpeakStateOf(OFFPEAK_SCHEDULE.opencode, new Date('2026-11-21T12:00:00Z'))).toEqual({ active: true, endsAt: '2026-11-23T01:00:00.000Z' })
    expect(offpeakStateOf(OFFPEAK_SCHEDULE.ollama, new Date('2026-11-21T12:00:00Z'))).toEqual({ active: true, endsAt: '2026-11-23T12:00:00.000Z' })
  })
})

// 조사된 평일 Peak 경계의 직전·정각·직후를 스케줄 표현과 독립된 표로 고정한다.
const boundaries = [
  ['opencode', '01:00', true, '2026-11-16T01:00:00.000Z', false, '2026-11-16T04:00:00.000Z'],
  ['opencode', '04:00', false, '2026-11-16T04:00:00.000Z', true, '2026-11-16T06:00:00.000Z'],
  ['opencode', '06:00', true, '2026-11-16T06:00:00.000Z', false, '2026-11-16T10:00:00.000Z'],
  ['opencode', '10:00', false, '2026-11-16T10:00:00.000Z', true, '2026-11-17T01:00:00.000Z'],
  ['ollama', '12:00', true, '2026-11-16T12:00:00.000Z', false, '2026-11-16T18:00:00.000Z'],
  ['ollama', '18:00', false, '2026-11-16T18:00:00.000Z', true, '2026-11-17T12:00:00.000Z'],
] as const
describe('Given production weekday UTC peak boundaries', () => {
  for (const [provider, time, beforeActive, beforeAt, afterActive, afterAt] of boundaries) {
    it.each([-1, 0, 1])(`When ${provider} is evaluated at ${time} UTC offset %i ms Then start is inclusive and end exclusive`, offset => {
      const now = new Date(Date.parse(`2026-11-16T${time}:00Z`) + offset)
      const active = offset < 0 ? beforeActive : afterActive
      const at = offset < 0 ? beforeAt : afterAt
      expect(offpeakStateOf(OFFPEAK_SCHEDULE[provider], now)).toEqual(active ? { active, endsAt: at } : { active, startsAt: at })
    })
  }
})
