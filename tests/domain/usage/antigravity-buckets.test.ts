import { describe, it, expect } from 'vitest'
import { scanAntigravityBuckets } from '@domain/usage/antigravity-buckets'
describe('Given Antigravity response shapes', () => {
  it.each([null, [], {}, {groups:null}])('When groups is missing (%j) Then reports invalid shape', raw => {
    expect(scanAntigravityBuckets(raw)).toEqual({ buckets: [], issues: [{code:'invalid_shape'}] })
  })
  it('When groups or bucket values are malformed Then reports paths and retains valid buckets', () => {
    const result = scanAntigravityBuckets({groups:[null,{buckets:null},{buckets:[null, {remainingFraction:-1}, {remainingFraction:2}, {remainingFraction:NaN}, {remainingFraction:'1'}, {remainingFraction:0,resetTime:'invalid'}]}]})
    expect(result.buckets).toHaveLength(1)
    expect(result.buckets[0]).toMatchObject({id:'groups[2].buckets[5]', usedPercent:100, resetsAt:null, groupLabel:'그룹 3'})
    expect(result.issues).toHaveLength(7)
  })
  it('When ids are duplicate Then every duplicate uses its JSON path', () => {
    const result = scanAntigravityBuckets({groups:[{buckets:[{bucketId:'same',remainingFraction:1}]},{buckets:[{bucketId:'same',remainingFraction:0},{bucketId:'unique',remainingFraction:0.5}]}]})
    expect(result.buckets.map(b=>b.id)).toEqual(['groups[0].buckets[0]','groups[1].buckets[0]','unique'])
  })
})
