import { describe, expect, it } from 'vitest'
import { offpeakNoticeOf } from '@app/usage/offpeak-notice'
import { OFFPEAK_SCHEDULE } from '@domain/usage/offpeak-schedule'
import { timeText } from '@app/usage/usage-text'
const schedule = { opencode: { windows: [{ start: '16:30', end: '22:30' }] }, ollama: { windows: [{ start: '16:30', end: '22:30' }] } }
describe('Given an off-peak notice', () => {
  it('When no rule exists Then no notice is shown', () => {
    expect(offpeakNoticeOf('claude', schedule, new Date())).toBeNull()
  })
  it('When active Then local end time and discount are described separately', () => {
    const notice = offpeakNoticeOf('opencode', schedule, new Date('2026-11-16T17:00:00Z'), { timeZone: 'Asia/Seoul' })
    expect(notice).toEqual({ active: true, text: 'off-peak · 07:30까지', description: 'OpenCode off-peak 시간대 · 07:30에 끝남 · DeepSeek 단가 50 퍼센트 할인' })
  })
  it.each([
    ['2026-11-16T17:00:00Z', true, 'off-peak · 22:30까지', 'Ollama off-peak 시간대 · 22:30에 끝남 · DeepSeek 단가 50 퍼센트 할인'],
    ['2026-11-16T12:00:00Z', false, 'off-peak 16:30부터', 'Ollama off-peak 시간대 아님 · 16:30에 시작 · DeepSeek 단가 50 퍼센트 할인'],
  ] as const)('When Ollama is evaluated at %s Then only the description includes its DeepSeek discount', (iso, active, text, description) => {
    expect(offpeakNoticeOf('ollama', schedule, new Date(iso), { timeZone: 'UTC' })).toEqual({ active, text, description })
  })
  it('When inactive Then the next start is displayed', () => {
    expect(offpeakNoticeOf('opencode', schedule, new Date('2026-11-16T12:00:00Z'), { timeZone: 'UTC' })).toEqual({ active: false, text: 'off-peak 16:30부터', description: 'OpenCode off-peak 시간대 아님 · 16:30에 시작 · DeepSeek 단가 50 퍼센트 할인' })
  })
  it('When transition is on a later local date Then local weekday is included', () => {
    expect(offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '00:00', end: '24:00', days: [6] }] } }, new Date('2026-11-19T00:00:00Z'), { timeZone: 'Asia/Seoul' })?.text).toBe('off-peak 토 09:00부터')
  })
  it('When timeText receives an explicit zone Then it formats deterministically', () => {
    expect(timeText('2026-11-16T17:00:00Z', 'UTC')).toBe('17:00')
    expect(timeText('invalid', 'UTC')).toBe('--:--')
  })
})

describe('Given transitions near local calendar boundaries', () => {
  it.each([
    ['opencode', 'off-peak · 월 10:00까지'],
    ['ollama', 'off-peak · 월 21:00까지'],
  ] as const)('When %s is active on Sunday evening in Seoul Then its Monday end includes the weekday', (provider, text) => {
    const notice = offpeakNoticeOf(provider, OFFPEAK_SCHEDULE, new Date('2026-11-15T10:55:00Z'), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe(text)
    expect(notice?.description).toContain(provider === 'opencode' ? '월 10:00에 끝남' : '월 21:00에 끝남')
  })
  it.each([
    ['2026-11-16T14:59:59Z', 'off-peak · 화 01:00까지', '화 01:00에 끝남'],
    ['2026-11-16T15:00:00Z', 'off-peak · 01:00까지', '· 01:00에 끝남'],
    ['2026-11-16T15:00:01Z', 'off-peak · 01:00까지', '· 01:00에 끝남'],
  ])('When now is %s around Seoul midnight Then end labels compare local dates', (iso, text, description) => {
    const notice = offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '14:00', end: '16:00' }] } }, new Date(iso), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe(text)
    expect(notice?.description).toContain(description)
  })
  it.each([
    ['2026-11-16T14:59:59Z', 'off-peak 화 00:01부터', '화 00:01에 시작'],
    ['2026-11-16T15:00:00Z', 'off-peak 00:01부터', '· 00:01에 시작'],
    ['2026-11-16T15:00:01Z', 'off-peak 00:01부터', '· 00:01에 시작'],
  ])('When inactive at %s around Seoul midnight Then start labels compare local dates', (iso, text, description) => {
    const notice = offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '15:01', end: '16:00' }] } }, new Date(iso), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe(text)
    expect(notice?.description).toContain(description)
  })
  it('When UTC midnight passes within the same Seoul date Then no weekday is added', () => {
    const notice = offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '23:00', end: '00:30' }] } }, new Date('2026-11-16T23:59:59Z'), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe('off-peak · 09:30까지')
  })
  it('When a transition is exactly 24 hours away Then its different local date includes the weekday', () => {
    const notice = offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '16:30', end: '22:30', days: [2] }] } }, new Date('2026-11-16T16:30:00Z'), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe('off-peak 수 01:30부터')
  })
  it('When the local date crosses a year boundary Then the weekday is included', () => {
    const notice = offpeakNoticeOf('ollama', { ollama: { windows: [{ start: '14:00', end: '16:00' }] } }, new Date('2026-12-31T14:59:59Z'), { timeZone: 'Asia/Seoul' })
    expect(notice?.text).toBe('off-peak · 금 01:00까지')
  })
})
