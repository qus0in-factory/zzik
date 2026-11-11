import { describe, expect, it } from 'vitest'
import { buildEnvelope, sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const NOW_ISO = new Date(NOW).toISOString()
const BODY = '{"five_hour":{"utilization":37,"resets_at":"2026-11-11T14:13:00.000Z"}}'
const TOKEN = 'sk-ant-secret-token-value'

function baseInput(overrides = {}) {
  return {
    nowMs: NOW,
    status: 'ok',
    called: true,
    httpStatus: 200,
    retryAtMs: null,
    credentialExpiresAt: Date.parse('2026-11-11T18:00:00.000Z'),
    bodyText: BODY,
    previous: null,
    intervalSec: 300,
    collectorVersion: '0.2.0',
    ...overrides,
  }
}

describe('Given a successful usage call', () => {
  it('When the response body fits then the envelope carries the raw text verbatim', () => {
    const envelope = buildEnvelope(baseInput())
    expect(envelope).toMatchObject({
      schema: 1,
      provider: 'claude',
      status: 'ok',
      called: true,
      runAt: NOW_ISO,
      fetchedAt: NOW_ISO,
      httpStatus: 200,
      retryAt: null,
      tokenExpiresAt: '2026-11-11T18:00:00.000Z',
      kvTokenExpiresAt: null,
      intervalSec: 300,
      collectorVersion: '0.2.0',
      rawText: BODY,
      rawOmitted: null,
    })
  })

  it('When the response body exceeds 64KB then it is recorded as omitted but still a success', () => {
    const big = '{"five_hour":{"utilization":1,"padding":"' + 'a'.repeat(65_536) + '"}}'
    const envelope = buildEnvelope(baseInput({ bodyText: big }))
    expect(envelope.status).toBe('ok')
    expect(envelope.rawText).toBeNull()
    expect(envelope.rawOmitted).toBe('too_large')
  })

  it('When the body is exactly 64KB or less then it is kept', () => {
    const body = 'x'.repeat(65_536)
    const envelope = buildEnvelope(baseInput({ bodyText: body }))
    expect(envelope.rawText).toBe(body)
    expect(envelope.rawOmitted).toBeNull()
  })
})

describe('Given failed or skipped runs over a previous success', () => {
  const previous = buildEnvelope(baseInput())

  it('When a 429 follows a success then rawText, fetchedAt and httpStatus are preserved or updated correctly', () => {
    const envelope = buildEnvelope(
      baseInput({ status: 'rate_limited', httpStatus: 429, bodyText: null, retryAtMs: NOW + 600_000, previous }),
    )
    expect(envelope.status).toBe('rate_limited')
    expect(envelope.fetchedAt).toBe(previous.fetchedAt)
    expect(envelope.rawText).toBe(previous.rawText)
    expect(envelope.httpStatus).toBe(429)
    expect(envelope.retryAt).toBe(new Date(NOW + 600_000).toISOString())
  })

  it('When an upstream error has no http response then the previous status code stays', () => {
    const envelope = buildEnvelope(baseInput({ status: 'upstream_error', called: true, httpStatus: null, bodyText: null, previous }))
    expect(envelope.httpStatus).toBe(previous.httpStatus)
    expect(envelope.called).toBe(true)
  })

  it('When a gate skips the run then called is false and the previous fields stay', () => {
    const rateLimited = buildEnvelope(
      baseInput({ status: 'rate_limited', httpStatus: 429, bodyText: null, retryAtMs: NOW + 600_000, previous }),
    )
    const skipped = buildEnvelope(
      baseInput({ status: rateLimited.status, called: false, httpStatus: null, bodyText: null, previous: rateLimited }),
    )
    expect(skipped.called).toBe(false)
    expect(skipped.status).toBe('rate_limited')
    expect(skipped.httpStatus).toBe(429)
    expect(skipped.rawText).toBe(previous.rawText)
    expect(skipped.fetchedAt).toBe(previous.fetchedAt)
  })

  it('When the token expires before the run then nothing is called and the previous success persists', () => {
    const envelope = buildEnvelope(
      baseInput({ status: 'token_expired', called: false, httpStatus: null, bodyText: null, credentialExpiresAt: NOW - 10, previous }),
    )
    expect(envelope.status).toBe('token_expired')
    expect(envelope.called).toBe(false)
    expect(envelope.tokenExpiresAt).toBe(new Date(NOW - 10).toISOString())
    expect(envelope.rawText).toBe(previous.rawText)
  })

  it('When success follows an omitted body then the fresh body replaces the omission marker', () => {
    const omitted = buildEnvelope(baseInput({ bodyText: 'x'.repeat(70_000) }))
    expect(omitted.rawOmitted).toBe('too_large')
    const fresh = buildEnvelope(baseInput({ previous: omitted }))
    expect(fresh.rawText).toBe(BODY)
    expect(fresh.rawOmitted).toBeNull()
  })
})

describe('Given token secrecy', () => {
  it('When the envelope is serialized then the access token never appears', () => {
    // 토큰은 봉투 생성의 입력이 아니다. 입력 경계를 고정해 누수를 막는다.
    const envelope = buildEnvelope(baseInput({ token: TOKEN }))
    expect(JSON.stringify(envelope)).not.toContain(TOKEN)
  })
})

describe('Given the body digest for dry-run output', () => {
  it('When hashing text then the sha256 hex matches the known digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
