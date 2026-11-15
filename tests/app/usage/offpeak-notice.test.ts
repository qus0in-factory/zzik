import { describe, expect, it } from 'vitest'
import { offpeakNoticeOf } from '@app/usage/offpeak-notice'
import { timeText } from '@app/usage/usage-text'
const schedule = { opencode: { windows: [{ start: '16:30', end: '22:30' }] }, ollama: { windows: [{ start: '16:30', end: '22:30' }] } }
describe('Given an off-peak notice', () => {
  it('When no rule exists Then no notice is shown', () => {
    expect(offpeakNoticeOf('claude', schedule, new Date())).toBeNull()
  })
  it('When active Then local end time and discount are described separately', () => {
    const notice = offpeakNoticeOf('opencode', schedule, new Date('2026-11-16T17:00:00Z'), { timeZone: 'Asia/Seoul' })
    expect(notice).toEqual({ active: true, text: 'off-peak · 07:30까지', description: 'OpenCode off-peak 시간대 · 07:30에 끝남 · DeepSeek 단가 50 퍼센트 할인' })
    expect(offpeakNoticeOf('ollama', schedule, new Date('2026-11-16T17:00:00Z'), { timeZone: 'UTC' })?.description).not.toContain('할인')
  })
  it('When inactive Then the next start is displayed', () => {
    expect(offpeakNoticeOf('opencode', schedule, new Date('2026-11-16T12:00:00Z'), { timeZone: 'UTC' })).toEqual({ active: false, text: 'off-peak 16:30부터', description: 'OpenCode off-peak 시간대 아님 · 16:30에 시작 · DeepSeek 단가 50 퍼센트 할인' })
  })
  it('When transition is at least 24 hours away Then local weekday is included', () => {
    expect(offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '00:00', end: '24:00', days: [6] }] } }, new Date('2026-11-19T00:00:00Z'), { timeZone: 'Asia/Seoul' })?.text).toBe('off-peak 토 09:00부터')
  })
  it('When timeText receives an explicit zone Then it formats deterministically', () => {
    expect(timeText('2026-11-16T17:00:00Z', 'UTC')).toBe('17:00')
    expect(timeText('invalid', 'UTC')).toBe('--:--')
  })
})
