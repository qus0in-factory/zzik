import { describe, expect, it } from 'vitest'
import { chooseCredential, credentialExpired } from '../../../../collector/domain/usage/credential-choice.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
// Keychain 경로는 제거되었고 파일 읽기(~/.claude/.credentials.json) 하나만 남았지만,
// 여러 읽기 소스 중 최신 expiresAt을 고르는 규칙은 일반형으로 유지한다(D11 credential-choice).
const READ_NEWER = { source: 'primary', token: 't-newer', expiresAt: Date.parse('2026-11-12T12:00:00.000Z') }
const READ_OLDER = { source: 'secondary', token: 't-older', expiresAt: Date.parse('2026-11-10T12:00:00.000Z') }

describe('Given credential reads', () => {
  it('When several reads succeed then the latest expiresAt wins', () => {
    expect(chooseCredential([READ_OLDER, READ_NEWER], NOW)?.token).toBe('t-newer')
    expect(chooseCredential([READ_NEWER, READ_OLDER], NOW)?.token).toBe('t-newer')
  })

  it('When the expiresAt times are equal then the first read in list order wins', () => {
    expect(chooseCredential([READ_NEWER, { ...READ_OLDER, expiresAt: READ_NEWER.expiresAt }], NOW)?.source).toBe('primary')
  })

  it('When a reader failed then the remaining read is used', () => {
    expect(chooseCredential([null, READ_OLDER], NOW)?.token).toBe('t-older')
    expect(chooseCredential([READ_NEWER, null], NOW)?.token).toBe('t-newer')
  })

  it('When all reads failed then there is no credential at all', () => {
    expect(chooseCredential([], NOW)).toBeNull()
    expect(chooseCredential([null, null], NOW)).toBeNull()
  })
})

describe('Given a chosen credential (마진 포함 판정, v2 D4)', () => {
  it('When the expiresAt has passed then it is marked expired', () => {
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: NOW - 1 }, NOW)).toBe(true)
  })

  it('When the expiresAt equals now then the 60s margin applies (지났거나 마진 안)', () => {
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: NOW }, NOW)).toBe(true)
  })

  it('When the expiresAt is unknown then it is not marked expired (호출해서 401로 판정)', () => {
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: null }, NOW)).toBe(false)
  })
})

describe('Given the expiry margin (v2: 지났거나 마진 안이면 token_expired)', () => {
  it('When expiresAt is within the 60s margin then it is expired', () => {
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: NOW + 60_000 }, NOW)).toBe(true)
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: NOW + 59_999 }, NOW)).toBe(true)
  })
  it('When expiresAt is beyond the margin then it is not expired', () => {
    expect(credentialExpired({ source: 'file', token: 't', expiresAt: NOW + 60_001 }, NOW)).toBe(false)
  })
})
