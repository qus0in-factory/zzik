import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAgyQuotaTsv, argonBucketFromQuota, mergeArgonIntoSummary } from '../../../../collector/domain/usage/agy-quota-cli.mjs'

const live = readFileSync(new URL('../../../fixtures/agy-quota-cli.live.tsv', import.meta.url), 'utf8')
const noArgon = readFileSync(new URL('../../../fixtures/agy-quota-cli.no-argon.tsv', import.meta.url), 'utf8')

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

describe('Given the Argon weekly bucket', () => {
  it('When the Argon row exists Then a weekly bucket with fraction and reset comes out', () => {
    expect(argonBucketFromQuota(live)).toEqual({
      bucketId: 'argon-weekly',
      displayName: 'Weekly Limit Remaining',
      window: 'weekly',
      resetTime: '2026-11-14T06:07:10Z',
      remainingFraction: 0,
    })
  })
  it('When there is no Argon row Then null', () => {
    expect(argonBucketFromQuota(noArgon)).toBeNull()
    expect(argonBucketFromQuota('garbage')).toBeNull()
  })
})

describe('Given merging Argon into the summary body', () => {
  const bucket = argonBucketFromQuota(live)!
  const body = JSON.stringify({ groups: [{ displayName: 'Gemini Models', buckets: [] }], description: 'keep' })
  it('When the API has no Argon group Then one is appended and the rest is kept', () => {
    const merged = JSON.parse(mergeArgonIntoSummary(body, bucket))
    expect(merged.groups.map((g: { displayName: string }) => g.displayName)).toEqual(['Gemini Models', 'Gemini 4 Argon'])
    expect(merged.groups[1].buckets).toEqual([bucket])
    expect(merged.description).toBe('keep')
  })
  it('When the API already has Argon Then the body is returned unchanged', () => {
    const withArgon = JSON.stringify({ groups: [{ displayName: 'Gemini 4 Argon', buckets: [{ window: 'weekly', remainingFraction: 0.5 }] }] })
    expect(mergeArgonIntoSummary(withArgon, bucket)).toBe(withArgon)
  })
  it('When the body is not a groups object Then it is returned unchanged', () => {
    expect(mergeArgonIntoSummary('[1]', bucket)).toBe('[1]')
    expect(mergeArgonIntoSummary('{"a":1}', bucket)).toBe('{"a":1}')
    expect(mergeArgonIntoSummary('nope', bucket)).toBe('nope')
  })
})
