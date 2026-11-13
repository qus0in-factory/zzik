import { describe, it, expect } from 'vitest'
import { parseStoredSnapshot } from '../../../../worker/domain/usage/stored-snapshot'
describe('Given a stored snapshot', () => {
  it('When absent Then it returns null', () => expect(parseStoredSnapshot(null, 'claude')).toEqual({ ok: true, snapshot: null }))
  it('When an envelope has a schema and the matching provider Then it passes through without interpreting fields', () => {
    const snapshot = { schema: 99, provider: 'claude', rawText: 'untouched', unknown: [1] }
    expect(parseStoredSnapshot(JSON.stringify(snapshot), 'claude')).toEqual({ ok: true, snapshot })
  })
  it('When the envelope provider differs from the request Then it is corrupt (ADR 0.3 D7 502)', () => {
    const snapshot = { schema: 1, provider: 'codex', rawText: 'x' }
    expect(parseStoredSnapshot(JSON.stringify(snapshot), 'claude')).toEqual({ ok: false, reason: 'snapshot_corrupt' })
  })
  it('When the envelope has no provider field Then it is corrupt', () => {
    expect(parseStoredSnapshot('{"schema":1}', 'claude')).toEqual({ ok: false, reason: 'snapshot_corrupt' })
  })
  it('When a valid envelope is double encoded Then it is corrupt rather than silently unwrapped', () => {
    const envelope = { schema: 1, provider: 'claude', rawText: '{}' }
    expect(parseStoredSnapshot(JSON.stringify(JSON.stringify(envelope)), 'claude'))
      .toEqual({ ok: false, reason: 'snapshot_corrupt' })
  })
  it.each(['{', 'null', '[]', '1', '"text"'])('When stored value is %s Then it is corrupt', (raw) => {
    expect(parseStoredSnapshot(raw, 'claude')).toEqual({ ok: false, reason: 'snapshot_corrupt' })
  })
})
