import { describe, expect, it } from 'vitest'
import * as policy from '../../../../collector/app/usage/diff-alerts.mjs'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { formatLogLine } from '../../../../collector/infra/usage/log.mjs'
import { COLLECTOR_NOW, createFakeCollectorPorts } from '../../../fakes/collector-ports'
const now=Date.parse('2026-11-14T00:00:00Z')
const oldReset=now+3600000
const report=(usedPercent:number,minutes=0,resetsAt=oldReset,expired=false)=>({provider:'claude',nowMs:now+minutes*60000,primaryId:'seven_day',limits:[{id:'seven_day',label:'주간 한도',usedPercent,elapsedPercent:50,cycleSeconds:604800,resetsAt:new Date(resetsAt).toISOString(),expired}]})
const baseline=()=>policy.nextAlertState(null,report(95),[])
const step=(state:ReturnType<typeof baseline>,r:ReturnType<typeof report>)=>{const events=policy.diffAlerts(state,r);return{events,state:policy.nextAlertState(state,r,events)}}
describe('Given reset evidence across early zero and stale observations',()=>{
 it('When an expired positive is followed by zero Then reports exactly one primary reset',()=>{
  const stale=step(baseline(),report(95,70,oldReset,true))
  expect(stale.events).toEqual([])
  const zero=step(stale.state,report(0,85,oldReset,true))
  expect(zero.events).toHaveLength(1)
  expect(zero.events[0].kind).toBe('reset')
  expect(policy.diffAlerts(zero.state,report(0,100,oldReset,true))).toEqual([])
 })
 it('When zero arrives before the saved reset Then retains that boundary and reports its genuine reset later',()=>{
  const early=step(baseline(),report(0,45,now+8*86400000))
  expect(early.events.map(e=>e.kind)).toEqual(['level'])
  expect(policy.diffAlerts(early.state,report(0,59,now+8*86400000))).toEqual([])
  const actual=step(JSON.parse(JSON.stringify(early.state)),report(.4,75,now+8*86400000))
  expect(actual.events).toHaveLength(1)
  expect(actual.events[0]).toMatchObject({kind:'reset',usedPercent:.4})
  expect(policy.diffAlerts(actual.state,report(.4,90,now+8*86400000))).toEqual([])
 })
 it('When the early zero remains zero Then elapsed original reset still yields the reset label once',()=>{
  const early=step(baseline(),report(0,15))
  const actual=step(early.state,report(0,75,now+8*86400000))
  expect(actual.events.filter(e=>e.kind==='reset')).toHaveLength(1)
  expect(policy.diffAlerts(actual.state,report(0,90,now+8*86400000))).toEqual([])
 })
})
describe('Given baseline cooldown and bounded missing checkpoints',()=>{
 it('When initial danger clears Then waits 30 minutes even though no entry alert was sent',()=>{
  expect(step(baseline(),report(10,15)).events).toEqual([])
  expect(step(baseline(),report(10,30)).events).toMatchObject([{kind:'level',from:'danger',to:'normal'}])
 })
 it('When a window stays absent for N successful observations Then prunes it but keeps reappearing windows',()=>{
  expect(policy.ALERT_MISSING_MAX_CYCLES).toBe(96)
  let state=baseline()
  const absent=(n:number)=>({...report(0,n*15),primaryId:null,limits:[]})
  for(let i=1;i<96;i++)state=policy.nextAlertState(state,absent(i),[])
  expect(state.windows).toHaveProperty('seven_day')
  const reappeared=policy.nextAlertState(state,report(95,95*15,now+8*86400000),[])
  expect(reappeared.windows.seven_day.missingCycles).toBe(0)
  state=policy.nextAlertState(state,absent(96),[])
  expect(state.windows).not.toHaveProperty('seven_day')
  expect(state.primaryId).toBeNull()
 })
})
describe('Given a failing local state write',()=>{
 it('When the database write succeeded Then logs one provider result, emits nothing and returns failure',async()=>{
  const p=createFakeCollectorPorts()
  const queue=(used:number)=>{p.credentials.queueReads([{source:'file',token:'synthetic',expiresAt:null}]);p.usage.queueUsage({ok:true,httpStatus:200,retryAfterSec:null,bodyText:JSON.stringify({five_hour:{utilization:used,resets_at:new Date(COLLECTOR_NOW+9000000).toISOString()}})})}
  queue(10);await runOnce(p)
  const previous=p.state.snapshot(), logs=p.logger.entries.length
  p.state.write=async()=>{throw Error('private path and token')}
  queue(75)
  const result=await runOnce(p)
  expect(result).toEqual({exitCode:4})
  expect(p.state.snapshot()).toEqual(previous)
  expect(p.logger.entries).toHaveLength(logs+1)
  const entry=p.logger.entries.at(-1)!
  expect(entry).toMatchObject({provider:'claude',status:'ok',kvOk:true,stateOk:false})
  const line=formatLogLine(entry as never)
  expect(line).toContain('state=fail')
  expect(line).not.toContain('private path and token')
 })
})
