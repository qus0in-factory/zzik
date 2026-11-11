import { describe, expect, it } from 'vitest'
import { formatAge, formatResetRemaining, isResetExpired } from '@domain/usage/staleness'

const NOW = new Date('2026-11-11T12:00:00.000Z')

describe('Given resets remaining formatting', () => {
  it.each([
    ['2026-11-11T14:13:00.000Z', '2시간 13분 후 리셋'],
    ['2026-11-14T09:00:00.000Z', '2일 21시간 후 리셋'],
    ['2026-11-11T13:05:00.000Z', '1시간 5분 후 리셋'],
    ['2026-11-13T22:30:00.000Z', '2일 10시간 30분 후 리셋'],
    ['2026-11-11T12:47:00.000Z', '47분 후 리셋'],
    ['2026-11-11T12:00:30.000Z', '곧 리셋'],
    ['2026-11-11T12:00:00.000Z', '곧 리셋'],
    ['2026-11-11T11:30:00.000Z', '리셋 시각 경과'],
    [null, '리셋 정보 없음'],
    [undefined, '리셋 정보 없음'],
    ['not-a-date', '리셋 정보 없음'],
  ] as const)('When resets_at is %j then the text is %s', (resetsAt, expected) => {
    expect(formatResetRemaining(resetsAt, NOW)).toBe(expected)
  })

  it('When the remaining time is an exact hour or day then zero units are omitted', () => {
    expect(formatResetRemaining('2026-11-11T15:00:00.000Z', NOW)).toBe('3시간 후 리셋')
    expect(formatResetRemaining('2026-11-14T12:00:00.000Z', NOW)).toBe('3일 후 리셋')
  })
})

describe('Given reset expiry decisions', () => {
  it('When resets_at is before now then the entry is expired', () => {
    expect(isResetExpired('2026-11-11T11:30:00.000Z', NOW)).toBe(true)
  })
  it('When resets_at is after now then the entry is not expired', () => {
    expect(isResetExpired('2026-11-12T08:00:00.000Z', NOW)).toBe(false)
  })
  it('When resets_at equals now then the entry is not expired', () => {
    expect(isResetExpired('2026-11-11T12:00:00.000Z', NOW)).toBe(false)
  })
  it('When resets_at is missing or unparseable then the entry is conservatively not expired', () => {
    expect(isResetExpired(null, NOW)).toBe(false)
    expect(isResetExpired(undefined, NOW)).toBe(false)
    expect(isResetExpired('not-a-date', NOW)).toBe(false)
  })
})

describe('Given age formatting for the status line', () => {
  it.each([
    ['2026-11-11T11:58:00.000Z', '2분 전'],
    ['2026-11-11T11:59:40.000Z', '방금 전'],
    ['2026-11-11T10:35:00.000Z', '1시간 25분 전'],
    ['2026-11-09T12:00:00.000Z', '2일 전'],
  ] as const)('When the last success was at %j then it reads %s at now', (iso, expected) => {
    expect(formatAge(iso, NOW)).toBe(expected)
  })
})
