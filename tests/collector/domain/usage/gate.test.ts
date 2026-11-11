import { describe, expect, it } from 'vitest'
import { gateAllowsCall, openGateFor, gateRetryAt, resetGate, emptyGate } from '../../../../collector/domain/usage/gate.mjs'
import { authRetryDelaySec } from '../../../../collector/domain/usage/backoff.mjs'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const HOUR_SEC = 3600

describe('Given an empty gate', () => {
  it('When deciding then the call is always allowed', () => {
    expect(gateAllowsCall(emptyGate(), NOW, null).allowed).toBe(true)
  })
})

describe('Given a gate opened by 429', () => {
  const gate = openGateFor(emptyGate(), { now: NOW, kind: 'rate_limited', delaySec: 600, credentialExpiresAt: null })

  it('When the next allowed time has not passed then the call is blocked', () => {
    expect(gateAllowsCall(gate, NOW + 60_000, null)).toEqual({ allowed: false })
  })

  it('When the next allowed time has passed then the call is allowed', () => {
    expect(gateAllowsCall(gate, NOW + 600_000, null).allowed).toBe(true)
    expect(gateAllowsCall(gate, NOW + 1_000_000, null).allowed).toBe(true)
  })

  it('When reporting retry timing then the retryAt equals the next allowed time', () => {
    expect(gateRetryAt(gate)).toBe(NOW + 600_000)
  })
})

describe('Given a gate opened by auth_required(401)', () => {
  const expiresAt = Date.parse('2026-11-11T18:00:00.000Z')
  const gate = openGateFor(emptyGate(), { now: NOW, kind: 'auth_required', delaySec: HOUR_SEC, credentialExpiresAt: expiresAt })

  it('When the credential has not changed then the call stays blocked for an hour', () => {
    expect(gateAllowsCall(gate, NOW + 60_000, expiresAt).allowed).toBe(false)
  })

  it('When the credential expiresAt changes then the gate releases immediately', () => {
    const refreshed = expiresAt + 90_000
    expect(gateAllowsCall(gate, NOW + 60_000, refreshed).allowed).toBe(true)
  })

  it('When a hour has passed then the call is allowed', () => {
    expect(gateAllowsCall(gate, NOW + HOUR_SEC * 1000, expiresAt).allowed).toBe(true)
  })
})

describe('Given a successful run', () => {
  it('When the gate is reset then nothing blocks and counters are cleared', () => {
    const gate = openGateFor(
      openGateFor(emptyGate(), { now: NOW, kind: 'rate_limited', delaySec: 600, credentialExpiresAt: null }),
      { now: NOW, kind: 'rate_limited', delaySec: 1200, credentialExpiresAt: null },
    )
    const reset = resetGate()
    expect(reset.nextAllowedAt).toBeNull()
    expect(reset.failCount).toBe(0)
    expect(reset.failReason).toBeNull()
    expect(gateAllowsCall(reset, NOW, null).allowed).toBe(true)
  })
})

describe('Given back-to-back auth denials (v2 D4 수열 + 전용 카운터)', () => {
  it('When denial repeats then the wait grows 3600 → 7200 in a SEPARATE counter (429·5xx와 분리)', () => {
    const first = openGateFor(emptyGate(), { now: NOW, kind: 'auth_rejected', delaySec: authRetryDelaySec(0), credentialExpiresAt: 100 })
    expect(first.nextAllowedAt).toBe(NOW + 3_600_000)
    expect(first.authFailCount).toBe(1)
    expect(first.failCount).toBe(0)
    const second = openGateFor(first, { now: NOW + 3_600_000, kind: 'auth_required', delaySec: authRetryDelaySec(1), credentialExpiresAt: 100 })
    expect(second.nextAllowedAt).toBe(NOW + 3_600_000 + 7_200_000)
    expect(second.authFailCount).toBe(2)
    expect(second.failCount).toBe(0)
  })

  it('When 429 and auth denials interleave then each lane keeps its own count', () => {
    const rate = openGateFor(emptyGate(), { now: NOW, kind: 'rate_limited', delaySec: 600, credentialExpiresAt: null })
    expect(rate.failCount).toBe(1)
    const auth = openGateFor(rate, { now: NOW + 600_000, kind: 'auth_rejected', delaySec: 3_600, credentialExpiresAt: 100 })
    expect(auth.failCount).toBe(1)     // rate 레인 보존
    expect(auth.authFailCount).toBe(1) // auth 레인 독립
  })

  it('When a blocked upstream response (diag blocked*) then the 429 sequence applies 600 → 1200 (상한 3,600)', () => {
    const first = openGateFor(emptyGate(), { now: NOW, kind: 'rate_limited', delaySec: 600, credentialExpiresAt: null })
    const second = openGateFor(first, { now: NOW + 600_000, kind: 'rate_limited', delaySec: 1_200, credentialExpiresAt: null })
    expect(second.nextAllowedAt).toBe(NOW + 1_800_000) // NOW+600s 첫 대기, +1200s 둘째 대기
    expect(first.nextAllowedAt).toBe(NOW + 600_000)
  })
})
