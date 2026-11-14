import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAgyQuotaTsv, buildQuotaRawText, AGY_QUOTA_RAW_SOURCE, AGY_QUOTA_RAW_SCHEMA } from '../../../../collector/domain/usage/agy-quota-cli.mjs'

const live = readFileSync(new URL('../../../fixtures/agy-quota-cli.live.tsv', import.meta.url), 'utf8')

describe('Given the agy /quota TSV parser (실제 출력 형상)', () => {
  it('When parsing the live output Then five rows with group, label, remaining fraction and reset time', () => {
    const rows = parseAgyQuotaTsv(live)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual({ group: 'Gemini Models', label: 'Weekly Limit Remaining', remainingFraction: 0.12, resetTime: '2026-11-14T04:46:03Z' })
    expect(rows[4]).toMatchObject({ group: 'Gemini 4 Argon', label: 'Gemini 4 Argon Weekly Limit', remainingFraction: 0 })
  })
  it('When lines are blank, short, or have a bad percent/time Then they are skipped', () => {
    const text = ['', 'Quota:', 'a\tb\t5%', 'a\tb\tx%\t2026-11-14T04:46:03Z', 'a\tb\t5%\tnot-a-time', 'a\tb\t150%\t2026-11-14T04:46:03Z', 'ok\tL\t50%\t2026-11-14T04:46:03Z'].join('\n')
    expect(parseAgyQuotaTsv(text)).toEqual([{ group: 'ok', label: 'L', remainingFraction: 0.5, resetTime: '2026-11-14T04:46:03Z' }])
  })
  it.each([null, undefined, '', 42])('When the input is %j Then no rows', (value) => {
    expect(parseAgyQuotaTsv(value as never)).toEqual([])
  })
})

describe('Given the stored CLI quota raw text', () => {
  it('When the live output is stored Then it keeps only group, label, remaining percent and reset time', () => {
    const raw = buildQuotaRawText(live)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as { source: string; schema: number; rows: Array<Record<string, unknown>> }
    expect(parsed.source).toBe(AGY_QUOTA_RAW_SOURCE)
    expect(parsed.schema).toBe(AGY_QUOTA_RAW_SCHEMA)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows[0]).toEqual({ group: 'Gemini Models', label: 'Weekly Limit Remaining', remainingPercent: 12, resetsAt: '2026-11-14T04:46:03Z' })
    expect(parsed.rows[4]).toMatchObject({ group: 'Gemini 4 Argon', remainingPercent: 0 })
    const serialized = JSON.stringify(parsed)
    for (const forbidden of ['email', 'account', 'token', 'refresh']) expect(serialized).not.toContain(forbidden)
  })
  it('When no row is valid Then there is no raw text', () => {
    expect(buildQuotaRawText('garbage')).toBeNull()
    expect(buildQuotaRawText(null)).toBeNull()
  })
})
