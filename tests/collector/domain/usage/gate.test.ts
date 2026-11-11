import { describe, expect, it } from 'vitest'
import { gateAllowsCall, openGateFor, gateRetryAt, resetGate, emptyGate } from '../../../../collector/domain/usage/gate.mjs'

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
    const reset = resetGate(gate)
    expect(reset.nextAllowedAt).toBeNull()
    expect(reset.failCount).toBe(0)
    expect(reset.failReason).toBeNull()
    expect(gateAllowsCall(reset, NOW, null).allowed).toBe(true)
  })
})
