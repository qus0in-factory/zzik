import { describe, it, expect } from 'vitest'
import { parseStoredSnapshot } from '../../../../worker/domain/usage/stored-snapshot'
describe('Given a stored snapshot', () => {
  it('When absent Then it returns null', () => expect(parseStoredSnapshot(null)).toEqual({ ok: true, snapshot: null }))
  it('When an envelope has a schema Then it passes through without interpreting fields', () => {
    const snapshot = { schema: 99, rawText: 'untouched', unknown: [1] }
    expect(parseStoredSnapshot(JSON.stringify(snapshot))).toEqual({ ok: true, snapshot })
  })
  it.each(['{', 'null', '[]', '1', '"text"', '{}'])('When stored value is %s Then it is corrupt', (raw) => {
    expect(parseStoredSnapshot(raw)).toEqual({ ok: false, reason: 'snapshot_corrupt' })
  })
})
