import { describe, expect, it } from 'vitest'
import { ledgerToLegacyState } from '../../../../collector/domain/usage/d1-legacy-state.mjs'
import { D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'

function state() {
  return { provider: 'claude', gate: { nextAllowedAt: 2000, failReason: 'auth_required', failCount: 2, authFailCount: 3, authDeniedExpiresAt: 1500 },
    alerts: { version: 1, primaryId: 'seven_day', windows: {} }, lastRun: { status: 'auth_rejected', tokenExpiresAt: 1500 }, lastPruneAt: D1_NOW,
    capturedPrevious: d1Envelope({ status: 'upstream_error' }), capturedLastEventAt: '2026-11-16T03:01:00.000Z' }
}
describe('Given a ledger rollback after a PG commit or the declared PG-only fallback', () => {
  it('When converting Then takes previous/event baseline from PG and current gate, alerts and lastRun from ledger', () => {
    const ledger = state(), pg = { provider: 'claude', previous: d1Envelope(), lastEventAt: D1_NOW }
    const before = structuredClone({ ledger, pg })
    const result = successValue(ledgerToLegacyState(ledger, pg))
    expect(result.providerState).toEqual({ schema: 1, provider: 'claude', previous: pg.previous, lastEventAt: D1_NOW, gate: ledger.gate, alerts: ledger.alerts, lastRun: ledger.lastRun, lastPruneAt: D1_NOW })
    expect(result.pruneState.lastPruneAt).toBe(D1_NOW)
    expect(result.warnings).toEqual([])
    result.providerState.gate.failCount = 99
    expect({ ledger, pg }).toEqual(before)
    expect(JSON.stringify(result.providerState)).not.toContain('capturedPrevious')
  })
  it('When PG has no prior observation Then does not substitute a captured or D1-only envelope', () => {
    const result = successValue(ledgerToLegacyState(state(), { provider: 'claude', previous: null, lastEventAt: null }))
    expect(result.providerState.previous).toBeNull()
    expect(result.providerState.lastRun).toEqual(state().lastRun)
  })
  it('When provider or gate is corrupt Then fails closed instead of resetting authentication backoff', () => {
    const pg = { provider: 'claude', previous: d1Envelope(), lastEventAt: D1_NOW }
    expect(ledgerToLegacyState(state(), { ...pg, provider: 'codex' }).ok).toBe(false)
    expect(ledgerToLegacyState({ ...state(), gate: { ...state().gate, authFailCount: -1 } }, pg).ok).toBe(false)
    expect(ledgerToLegacyState({ ...state(), alerts: { invalid: true } }, pg).ok).toBe(false)
    expect(ledgerToLegacyState(state(), { ...pg, lastEventAt: '2026-11-17T00:00:00.000Z' }).ok).toBe(false)
  })
  it('When prune time is absent or invalid Then reports unknown rather than inventing the current time', () => {
    for (const lastPruneAt of [undefined, null, 'not-a-date']) {
      const result = successValue(ledgerToLegacyState({ ...state(), lastPruneAt }, { provider: 'claude', previous: d1Envelope(), lastEventAt: D1_NOW }))
      expect(result.pruneState.lastPruneAt).toBeNull()
      expect(result.warnings).toEqual(['prune_time_unknown'])
    }
  })
})


describe('Given a future ledger with internal fields beside legacy fields', () => {
  it('When projecting Then excludes unknown gate, alert and lastRun fields from old JSON', () => {
    const current = state()
    const result = successValue(ledgerToLegacyState({ ...current, gate: { ...current.gate, internal: 'do-not-copy' }, alerts: { ...current.alerts, internal: 'do-not-copy' }, lastRun: { ...current.lastRun, internal: 'do-not-copy' } }, { provider: 'claude', previous: d1Envelope(), lastEventAt: D1_NOW }))
    expect(JSON.stringify(result)).not.toContain('do-not-copy')
  })
})
