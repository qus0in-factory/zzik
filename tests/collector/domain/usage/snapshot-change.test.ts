import { describe, it, expect } from 'vitest'
import { snapshotChanged } from '../../../../collector/domain/usage/snapshot-change.mjs'
describe('Given last persisted usage state', () => {
  it('When status and raw hash stay equal Then heartbeat changes do not create history', () => {
    expect(snapshotChanged(null,{status:'ok',rawSha256:null})).toBe(true)
    expect(snapshotChanged({status:'ok',rawSha256:null},{status:'ok',rawSha256:null})).toBe(false)
    expect(snapshotChanged({status:'ok',rawSha256:'same'},{status:'ok',rawSha256:'same'})).toBe(false)
    expect(snapshotChanged({status:'ok',rawSha256:'same'},{status:'token_expired',rawSha256:'same'})).toBe(true)
    expect(snapshotChanged({status:'ok',rawSha256:'a'},{status:'ok',rawSha256:'b'})).toBe(true)
  })
})
