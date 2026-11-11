import { describe, expect, it } from 'vitest'
import { rebaseUsageResetsAt } from '@domain/usage/calibration'
import type { RawUsage } from '@domain/usage/types'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import limitedRaw from '../../fixtures/claude-usage.limited.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'

const ANCHOR = new Date('2026-11-11T12:00:00.000Z')
const TEN_DAYS_LATER = new Date('2026-11-21T12:00:00.000Z')

describe('Given a fixture authored at the anchor time', () => {
  it('When rebased to a later time then every resets_at moves by the same delta', () => {
    const out = rebaseUsageResetsAt(normalRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    expect(out).toEqual({
      five_hour: { utilization: 37, resets_at: '2026-11-21T14:13:00.000Z' },
      seven_day: { utilization: 12, resets_at: '2026-11-24T09:00:00.000Z' },
      seven_day_opus: null,
      seven_day_sonnet: { utilization: 5, resets_at: '2026-11-24T09:00:00.000Z' },
      extra_usage: { utilization: 5 },
    })
  })

  it('When rebased then the relative spacing between entries is preserved', () => {
    const out = rebaseUsageResetsAt(normalRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    const fiveHour = Date.parse((out.five_hour as { resets_at: string }).resets_at)
    const sevenDay = Date.parse((out.seven_day as { resets_at: string }).resets_at)
    const sourceFiveHour = Date.parse('2026-11-11T14:13:00.000Z')
    const sourceSevenDay = Date.parse('2026-11-14T09:00:00.000Z')
    expect(sevenDay - fiveHour).toBe(sourceSevenDay - sourceFiveHour)
  })

  it('When the rebase target equals the anchor then values are unchanged', () => {
    expect(rebaseUsageResetsAt(normalRaw as RawUsage, ANCHOR, ANCHOR)).toEqual(normalRaw)
  })
})

describe('Given fixture entries that must not be rewritten', () => {
  it('When the value is null then it stays null', () => {
    const out = rebaseUsageResetsAt(normalRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    expect(out.seven_day_opus).toBeNull()
    expect(rebaseUsageResetsAt(unknownKeysRaw as RawUsage, ANCHOR, TEN_DAYS_LATER).seven_day_cowork).toBeNull()
  })

  it('When resets_at is null or absent then it stays as authored', () => {
    const out = rebaseUsageResetsAt(unknownKeysRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    expect(out.seven_day_haiku).toEqual({ utilization: 3, resets_at: null })
    expect(out.extra_usage).toEqual({ utilization: 5 })
  })

  it('When resets_at is not a parsable date then the entry is left untouched', () => {
    const input = {
      weird: { utilization: 1, resets_at: 'not-a-date' },
      plain: { utilization: 2 },
    } as unknown as RawUsage
    expect(rebaseUsageResetsAt(input, ANCHOR, TEN_DAYS_LATER)).toEqual(input)
  })

  it('When an entry is not an object then it is left untouched', () => {
    const input = { arr: [1, 2], text: 'x' } as unknown as RawUsage
    expect(rebaseUsageResetsAt(input, ANCHOR, TEN_DAYS_LATER)).toEqual(input)
  })
})

describe('Given a fixture with an already expired window', () => {
  it('When rebased then it stays in the past relative to the new now', () => {
    const out = rebaseUsageResetsAt(limitedRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    const cowork = out.seven_day_cowork as { utilization: number; resets_at: string }
    expect(Date.parse(cowork.resets_at)).toBeLessThan(TEN_DAYS_LATER.getTime())
    expect(cowork.resets_at).toBe('2026-11-21T11:30:00.000Z')
  })

  it('When a window was in the future then it stays in the future', () => {
    const out = rebaseUsageResetsAt(limitedRaw as RawUsage, ANCHOR, TEN_DAYS_LATER)
    const fiveHour = out.five_hour as { resets_at: string }
    expect(Date.parse(fiveHour.resets_at)).toBeGreaterThan(TEN_DAYS_LATER.getTime())
  })
})

describe('Given a raw usage object', () => {
  it('When rebased then the input is not mutated and the key order is kept', () => {
    const input = structuredClone(normalRaw) as RawUsage
    const before = structuredClone(input)
    const out = rebaseUsageResetsAt(input, ANCHOR, TEN_DAYS_LATER)
    expect(input).toEqual(before)
    expect(Object.keys(out)).toEqual(Object.keys(before))
    expect(out).not.toBe(input)
  })
})
