import { describe, expect, it } from 'vitest'
import { canonicalEnvelope, normalizeD1Instant, migrationRowTuple, checkMigrationTimeOrder } from '../../../../shared/d1-canonical'
import { migrationRowSha256, compareMigrationRows } from '../../../../collector/domain/usage/d1-migration.mjs'
import { sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'
import { D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'

export function row(overrides: Record<string, unknown> = {}) {
  return { id: '9007199254740993', provider: 'claude' as const, runAt: D1_NOW, status: 'ok' as const,
    rawSha256: sha256Hex(d1Envelope().rawText!), envelopeJson: JSON.stringify(d1Envelope()), ...overrides }
}

describe('Given the migration canonical tuple shared by both directions', () => {
  it('When JSON keys are reordered Then hashes identically but preserves array order and rawText bytes', () => {
    const envelope = d1Envelope()
    const reordered = Object.fromEntries(Object.entries(envelope).reverse())
    expect(migrationRowSha256(row())).toEqual(migrationRowSha256(row({ envelopeJson: JSON.stringify(reordered) })))
    const original = successValue(migrationRowSha256(row()))
    for (const patch of [{ intervalSec: 180 }, { fetchedAt: '2026-11-16T02:00:00.000Z' }, { rawRedacted: ['five_hour'] }, { rawText: '{"five_hour":{"utilization":38}}' }]) {
      expect(successValue(migrationRowSha256(row({ envelopeJson: JSON.stringify(d1Envelope(patch)) })))).not.toBe(original)
    }
    expect(successValue(canonicalEnvelope('{"nested":{"2":2,"10":10},"array":[2,1]}'))).toBe('{"array":[2,1],"nested":{"10":10,"2":2}}')
    expect(successValue(canonicalEnvelope('{"array":[1,2]}'))).not.toBe(successValue(canonicalEnvelope('{"array":[2,1]}')))
  })
  it('When columns are normalized Then keeps decimal ids exact and uses provider as the snapshot key and empty null raw hash', () => {
    const tuple = successValue(migrationRowTuple(row()))
    expect(tuple.startsWith('9007199254740993|claude|' + Date.parse(D1_NOW) + '|ok|')).toBe(true)
    expect(successValue(migrationRowSha256(row()))).toBe(sha256Hex(tuple))
    expect(successValue(migrationRowSha256(row()))).toBe('fa53a8e39ea356fddb463843c7751172791907ea90987fb777e60bc6c53d7f6a')
    expect(successValue(migrationRowTuple(row({ id: null, rawSha256: null }))).startsWith('claude|claude|')).toBe(true)
    for (const id of ['01', '0', '9223372036854775808', 9007199254740992]) expect(migrationRowSha256(row({ id })).ok).toBe(false)
    expect(migrationRowSha256(row({ id: '9223372036854775807' })).ok).toBe(true)
  })
  it('When a row disagrees with its envelope Then fails before hashing without leaking content', () => {
    for (const patch of [{ provider: 'codex' }, { status: 'upstream_error' }, { runAt: '2026-11-16T03:00:01.000Z' }, { envelopeJson: '"private double encoded"' }, { envelopeJson: '{"n":1e400}' }]) {
      const result = migrationRowSha256(row(patch))
      expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('private double')
    }
  })
  it('When an existing id has changed envelope metadata Then refuses reverse-import instead of ignoring the row', () => {
    expect(compareMigrationRows(row(), row())).toEqual({ ok: true, value: 'matching' })
    expect(compareMigrationRows(row(), row({ envelopeJson: JSON.stringify(d1Envelope({ rawRedacted: ['five_hour'] })) }))).toEqual({ ok: false, reason: 'migration_hash_mismatch' })
  })
})

describe('Given PG timestamps and Worker millisecond output', () => {
  it('When using offsets or sub-ms fractions Then truncates to the same UTC millisecond independent of TZ', () => {
    expect(successValue(normalizeD1Instant('2026-11-16T12:00:00.123999+09:00'))).toEqual({ ms: Date.parse(D1_NOW), iso: D1_NOW })
    expect(successValue(normalizeD1Instant('1969-12-31T23:59:59.999999Z')).ms).toBe(-1)
    expect(normalizeD1Instant('2026-02-30T00:00:00Z').ok).toBe(false)
    expect(normalizeD1Instant('2026-11-16T03:00:00').ok).toBe(false)
  })
  it('When order-check input is malformed Then fails closed without throwing', () => {
    for (const input of [null, [null], [{}]]) expect(() => { expect(checkMigrationTimeOrder(input as never).ok).toBe(false) }).not.toThrow()
  })
  it('When truncation reorders same-provider rows Then rejects, but equal-order and different providers remain valid', () => {
    const samples = [
      { provider: 'claude' as const, id: '2', runAt: '2026-11-16T03:00:00.000100Z' },
      { provider: 'claude' as const, id: '1', runAt: '2026-11-16T03:00:00.000900Z' },
    ]
    const copy = structuredClone(samples)
    expect(checkMigrationTimeOrder(samples)).toEqual({ ok: false, reason: 'millisecond_order_changed' })
    expect(checkMigrationTimeOrder([{ ...samples[0], id: '1' }, { ...samples[1], id: '2' }]).ok).toBe(true)
    expect(checkMigrationTimeOrder([samples[0], { ...samples[1], provider: 'codex' }]).ok).toBe(true)
    expect(samples).toEqual(copy)
  })
})
