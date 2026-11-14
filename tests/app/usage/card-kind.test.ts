import { describe, expect, it } from 'vitest'
import { cardKindOf } from '@app/usage/card-kind'

const DAY = 86_400

describe('Given the card kind (제목 아이콘 종류) by window id and cycle', () => {
  it.each([
    // 주기(초) 기반
    ['five_hour', 5 * 3600, 'window', 'short'],
    ['gemini-5h', 5 * 3600, 'window', 'short'],
    ['rate_limit.primary_window', 5 * 3600, 'window', 'short'],
    ['rolling', null, 'window', 'short'],
    ['seven_day', 7 * DAY, 'window', 'weekly'],
    ['gemini-weekly', 7 * DAY, 'window', 'weekly'],
    ['weekly', 7 * DAY, 'window', 'weekly'],
    ['monthly', 30 * DAY, 'window', 'monthly'],
    ['monthly', 28 * DAY, 'window', 'monthly'],
    ['monthly', 31 * DAY, 'window', 'monthly'],
    // 크레딧·추가 사용량은 주기와 무관하게 extra
    ['credits', 7 * DAY, 'window', 'extra'],
    ['included', 30 * DAY, 'window', 'extra'],
    ['extra_usage', null, 'metric', 'extra'],
    // 모델별 한도(metrics)
    ['seven_day_sonnet', null, 'metric', 'model'],
    ['seven_day_fable', null, 'metric', 'model'],
    ['seven_day_opus', null, 'metric', 'model'],
    // 알 수 없음
    ['something_new', null, 'window', 'unknown'],
    ['something_new', 3 * DAY, 'metric', 'unknown'],
    ['rate_limit.additional.x', null, 'metric', 'unknown'],
  ] as const)('When id=%s cycle=%s as %s Then %s', (id, cycleSeconds, group, kind) => {
    expect(cardKindOf({ id, cycleSeconds }, group)).toBe(kind)
  })
  it('When a metric has a known cycle Then the cycle decides (codex 1시간 한도 is short, weekly stays weekly)', () => {
    expect(cardKindOf({ id: 'rate_limit.additional.a', cycleSeconds: 3600 }, 'metric')).toBe('short')
    expect(cardKindOf({ id: 'rate_limit.additional.a', cycleSeconds: 7 * DAY }, 'metric')).toBe('weekly')
  })
  it('When cycleSeconds is undefined Then it falls back to id patterns', () => {
    expect(cardKindOf({ id: 'five_hour' }, 'window')).toBe('short')
    expect(cardKindOf({ id: 'seven_day' }, 'window')).toBe('weekly')
  })
})

describe('Given a model metric with a weekly cycle', () => {
  it('Then the model wins over the cycle (Claude seven_day_sonnet resets weekly)', () => {
    expect(cardKindOf({ id: 'seven_day_sonnet', cycleSeconds: 7 * 86_400 }, 'metric')).toBe('model')
  })
})
