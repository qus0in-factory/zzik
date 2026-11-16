import {describe,it,expect} from 'vitest'
import {d1RetryDelay,d1RetryAfterMs} from '../../../../collector/domain/usage/d1-delivery-policy.mjs'
describe('Given D1 retry policy distinct from provider authentication gates',()=>{
 it('When failures repeat Then uses full jitter with five-second base, 300-second cap and longer Retry-After',()=>{
  expect(d1RetryDelay(0,1,0)).toBe(5000);expect(d1RetryDelay(1,1,0)).toBe(10000)
  expect(d1RetryDelay(20,1,0)).toBe(300000);expect(d1RetryDelay(20,0,0)).toBe(0)
  expect(d1RetryDelay(0,0.5,60000)).toBe(60000)
 })
 it('When Retry-After is seconds or an HTTP-date Then retains the requested delay without a provider-specific minimum',()=>{
  const now=Date.parse('2026-11-16T00:00:00Z')
  expect(d1RetryAfterMs('5',now)).toBe(5000)
  expect(d1RetryAfterMs('Mon, 16 Nov 2026 00:01:00 GMT',now)).toBe(60000)
  for(const raw of [null,'bad','0','-1','900719925474099300000000'])expect(d1RetryAfterMs(raw,now)).toBe(0)
 })
})
