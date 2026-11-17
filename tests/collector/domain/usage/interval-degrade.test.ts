import {describe,it,expect} from 'vitest'
import {effectiveIntervalSec} from '../../../../collector/domain/usage/interval-degrade.mjs'
const day=86400000, now=20*day, policy={intervalSec:300,degrade:{intervalSec:900}}
describe('Given recent Claude rate limits',()=>{
 it('When no valid rate limit exists Then retains the base interval',()=>{
  expect(effectiveIntervalSec(policy,{},now)).toBe(300)
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[NaN,-1,now+1,now-7*day-1]},now)).toBe(300)
  expect(effectiveIntervalSec({intervalSec:300},{rateLimitedAtMs:[now]},now)).toBe(300)
 })
 it('When one rate limit occurs Then holds 900 through 24 hours',()=>{
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now]},now+day)).toBe(900)
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now]},now+day+1)).toBe(300)
 })
 it('When rate limits repeat Then doubles the hold up to seven days and excludes old entries',()=>{
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now-100,now]},now+2*day)).toBe(900)
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now-100,now]},now+2*day+1)).toBe(300)
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now,now,now,now]},now+7*day)).toBe(900)
  expect(effectiveIntervalSec(policy,{rateLimitedAtMs:[now-7*day-1,now]},now+day+1)).toBe(300)
 })
})
