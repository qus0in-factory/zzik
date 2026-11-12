import { describe, it, expect } from 'vitest'
import { rfc3339Ms } from '../../../../collector/domain/usage/rfc3339-ms.mjs'
describe('Given RFC3339 credential expiry', () => {
  it.each(['2026-11-13T12:34:56.123456+09:00','2026-11-13T03:34:56.123Z'])('When parsing %s Then truncates fractional milliseconds', value => {
    expect(rfc3339Ms(value)).toBe(Date.parse('2026-11-13T03:34:56.123Z'))
  })
  it('When seconds have no fraction Then accepts them; invalid values return null', () => {
    expect(rfc3339Ms('2026-11-13T03:34:56Z')).toBe(Date.parse('2026-11-13T03:34:56Z'))
    for (const value of ['', 'garbage', null, 123]) expect(rfc3339Ms(value)).toBeNull()
  })
})
