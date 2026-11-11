import { describe, expect, it } from 'vitest'
import { parseJwtExpiredAt } from '../../../../collector/domain/usage/jwt-exp.mjs'

/** 헤더.payload.시그니처 형태의 가짜 JWT를 만든다(서명이 아니라 exp 해석만 검증한다). */
function makeJwt(payloadObject: Record<string, unknown>) {
  const enc = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `h.${enc(payloadObject)}.s`
}

const NOW_MS = Date.parse('2026-11-11T12:00:00.000Z')

describe('Given the JWT exp reader', () => {
  it('When the payload has a numeric exp then it returns the epoch ms', () => {
    const token = makeJwt({ exp: 1762845600 })
    expect(parseJwtExpiredAt(token)).toBe(1762845600 * 1000)
  })

  it.each([['not-a-jwt'], ['h.s'], ['h..s'], [null], [undefined]] as const)('When the token is malformed (%j) then it returns null', (token) => {
    expect(parseJwtExpiredAt(token)).toBeNull()
  })

  it('When the token is not a string at all (숫자) then it returns null', () => {
    expect(parseJwtExpiredAt(42 as unknown as string)).toBeNull()
  })

  it('When the middle segment is not valid base64url then it returns null', () => {
    expect(parseJwtExpiredAt('h.!!!definitely-not-base64!!!.s')).toBeNull()
  })

  it('When the payload is not JSON then it returns null', () => {
    const broken = Buffer.from('{oops').toString('base64url')
    expect(parseJwtExpiredAt(`h.${broken}.s`)).toBeNull()
  })

  it('When the payload has no exp field then it returns null (만료 미상 → 호출해서 401로 판정)', () => {
    expect(parseJwtExpiredAt(makeJwt({ email: 'x' }))).toBeNull()
  })

  it('When exp is not a finite number then it returns null', () => {
    expect(parseJwtExpiredAt(makeJwt({ exp: 'tomorrow' }))).toBeNull()
    expect(parseJwtExpiredAt(makeJwt({ exp: Number.NaN }))).toBeNull()
  })

  it('When the payload carries other claims then the result only reflects exp (다른 클레임은 버린다)', () => {
    const got = parseJwtExpiredAt(makeJwt({ exp: 1799, email: 'a@b.c', plan: 'pro' }))
    expect(got).toBe(1799 * 1000)
  })
})
