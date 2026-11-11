import { describe, expect, it } from 'vitest'
import { applyRedactions } from '../../../../collector/domain/usage/redact.mjs'

describe('Given the identifier redaction (ADR 0.3 D5 가림)', () => {
  it('When the list is empty then the body is untouched without re-serialization', () => {
    const body = '{"a":{"email":"a@b.c"},"b":1}'
    expect(applyRedactions(body, [])).toEqual({ rawText: body })
    expect(applyRedactions(body, undefined)).toEqual({ rawText: body })
  })

  it('When the list names a path then its value becomes [가림] and the path is recorded', () => {
    const body = JSON.stringify({ account_email: 'a@b.c', used_percent: 5 })
    const applied = applyRedactions(body, ['account_email'])
    expect(JSON.parse(applied.rawText)).toEqual({ account_email: '[가림]', used_percent: 5 })
    expect(applied.rawRedacted).toEqual(['account_email'])
  })

  it('When the path is nested then only the named leaf is redacted and the structure is kept', () => {
    const body = JSON.stringify({ rate_limit: { account_email: 'a@b.c', used_percent: 37 } })
    const applied = applyRedactions(body, ['rate_limit.account_email'])
    const parsed = JSON.parse(applied.rawText) as Record<string, { account_email?: string; used_percent?: number }>
    expect(parsed.rate_limit.account_email).toBe('[가림]')
    expect(parsed.rate_limit.used_percent).toBe(37)
    expect(applied.rawRedacted).toEqual(['rate_limit.account_email'])
  })

  it('When a path does not exist then nothing is redacted and rawRedacted is absent', () => {
    const body = JSON.stringify({ a: { b: 1 } })
    const applied = applyRedactions(body, ['a.email'])
    expect(applied.rawText).toBe(body)
    expect(applied.rawRedacted).toBeUndefined()
  })

  it('When the body is not JSON then the original text passes through (본문을 해석하지 않는다)', () => {
    const body = 'not-a-json'
    expect(applyRedactions(body, ['a'])).toEqual({ rawText: body })
  })
})
