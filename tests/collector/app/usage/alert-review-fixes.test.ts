import { describe, expect, it } from 'vitest'
import { diffAlerts, nextAlertState } from '../../../../collector/app/usage/diff-alerts.mjs'
import { buildAlertReport } from '../../../../collector/domain/usage/alert-report.mjs'
import { formatAlertMessage } from '../../../../collector/domain/usage/alert-message.mjs'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { createFakeCollectorPorts, COLLECTOR_NOW } from '../../../fakes/collector-ports'
const start=Date.parse('2026-11-14T00:00:00Z')
const report=(used:number,minutes=0,extra:Record<string,unknown>={})=>({provider:'claude',nowMs:start+minutes*60000,primaryId:null,limits:[{id:'five_hour',label:'5시간 한도',usedPercent:used,elapsedPercent:50,cycleSeconds:18000,resetsAt:'2026-11-15T00:00:00Z',expired:false,...extra}]})
const baseline=(used=10)=>nextAlertState(null,report(used),[])
const step=(state:ReturnType<typeof baseline>,r:ReturnType<typeof report>)=>{const events=diffAlerts(state,r);for(const e of events)expect(e.from).not.toBe(e.to);return{events,state:nextAlertState(state,r,events)}}
describe('Given only the last notified level N controls transitions',()=>{
 it('When caution/normal oscillates Then never sends caution to caution',()=>{
  let state=baseline()
  const events=[]
  for(const [m,v] of [[0,75],[15,10],[30,75],[45,10],[60,75]]){const s=step(state,report(v,m));state=s.state;events.push(...s.events)}
  expect(events.map(e=>[e.from,e.to])).toEqual([['normal','caution'],['caution','normal']])
 })
 it('When danger eases then worsens Then cooldown permits an actual downgrade followed by immediate worsening',()=>{
  let s=step(baseline(),report(95))
  expect(step(s.state,report(75,15)).events).toEqual([])
  s=step(s.state,report(75,30))
  expect(s.events).toMatchObject([{from:'danger',to:'caution'}])
  expect(step(s.state,report(95,75)).events).toMatchObject([{from:'caution',to:'danger'}])
 })
 it('When a recently cleared limit reaches danger or limit Then reports immediately',()=>{
  const s=step(baseline(95),report(10,30))
  expect(step(s.state,report(100,31)).events).toMatchObject([{from:'normal',to:'limit'}])
 })
 it('When a clear waits at the cooldown boundary Then 30 minutes is inclusive',()=>{
  const s=step(baseline(),report(75))
  expect(step(s.state,{...report(10),nowMs:start+1799999}).events).toEqual([])
  expect(step(s.state,report(10,30)).events).toMatchObject([{to:'normal'}])
 })
 it('When pace is caution below 25% Then suppresses it without changing dashboard policy',()=>{
  const s=baseline(0)
  expect(step(s,report(24.9,0,{elapsedPercent:0})).events).toEqual([])
  expect(step(s,report(25,0,{elapsedPercent:0})).events).toMatchObject([{to:'caution'}])
  expect(step(s,report(95,0,{elapsedPercent:100})).events).toMatchObject([{to:'danger'}])
 })
})
describe('Given a new reset cycle, first observed after some usage',()=>{
 const before=(used=95)=>{const r={...report(used),primaryId:'five_hour',limits:[{...report(used).limits[0],id:'seven_day',label:'주간 한도',cycleSeconds:604800,resetsAt:new Date(start+60000).toISOString()}]};r.primaryId='seven_day';return nextAlertState(null,r,[])}
 const after=(used=.4)=>({...report(used,10),primaryId:'seven_day',limits:[{...report(used).limits[0],id:'seven_day',label:'주간 한도',elapsedPercent:.1,cycleSeconds:604800,resetsAt:new Date(start+7*86400000).toISOString()}]})
 it('When 0.4% follows an elapsed reset Then emits one reset and clears N instead of a generic release',()=>{
  const prev=before(), r=after(), events=diffAlerts(prev,r)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({kind:'reset',usedPercent:.4})
  expect(events[0].from).not.toBe(events[0].to)
  expect(formatAlertMessage(events)).toContain('사용 0.4%')
  const state=nextAlertState(prev,r,events)
  expect(state.windows.seven_day.notifiedLevel).toBe('normal')
  expect(diffAlerts(state,{...r,nowMs:start+20*60000})).toEqual([])
 })
 it('When a new cycle starts in caution Then later danger starts from normal, never the prior cycle limit',()=>{
  const prev=before(100), r=after(40), events=diffAlerts(prev,r)
  const state=nextAlertState(prev,r,events)
  expect(state.windows.seven_day.notifiedLevel).toBe('normal')
  const next=diffAlerts(state,after(95))
  expect(next).toMatchObject([{kind:'level',from:'normal',to:'danger'}])
  for(const e of [...events,...next])expect(e.from).not.toBe(e.to)
 })
 it('When N was already normal Then a genuine reset is still a distinct phase event',()=>{
  const events=diffAlerts(before(10),after())
  expect(events).toHaveLength(1)
  expect(events[0].kind).toBe('reset')
  expect(events[0].from).not.toBe(events[0].to)
 })
 it('When the old value remains expired or use has not dropped Then no reset is invented',()=>{
  const r=after()
  expect(diffAlerts(before(),{...r,limits:[{...r.limits[0],expired:true}]}).filter(e=>e.kind==='reset')).toEqual([])
  expect(diffAlerts(before(),after(96)).filter(e=>e.kind==='reset')).toEqual([])
 })
 it('When a non-primary 5h window resets Then clears its N without a primary reset notification',()=>{
  const prev=nextAlertState(null,report(95,0,{resetsAt:new Date(start+60000).toISOString()}),[])
  const r=report(.4,10,{elapsedPercent:.1})
  const events=diffAlerts(prev,r)
  expect(events).toMatchObject([{kind:'level',from:'danger',to:'normal'}])
  expect(nextAlertState(prev,r,events).windows.five_hour.notifiedLevel).toBe('normal')
 })
})
describe('Given failed alert calculation',()=>{
 it.each(['diff','advance'] as const)('When %s throws Then collection succeeds, emits nothing and preserves the checkpoint',async fail=>{
  const p=createFakeCollectorPorts()
  const queue=(n:number)=>{p.credentials.queueReads([{source:'file',token:'synthetic',expiresAt:null}]);p.usage.queueUsage({ok:true,httpStatus:200,retryAfterSec:null,bodyText:JSON.stringify({five_hour:{utilization:n,resets_at:new Date(COLLECTOR_NOW+9000000).toISOString()}})})}
  queue(10);await runOnce(p);const old=(p.state.snapshot() as {alerts:unknown}).alerts;queue(75)
  const result=await runOnce({...p,alertPolicy:{diff:fail==='diff'?()=>{throw Error('private')}:diffAlerts,advance:fail==='advance'?()=>{throw Error('private')}:nextAlertState}})
  expect(result).toEqual({exitCode:0})
  expect((p.state.snapshot() as {alerts:unknown}).alerts).toEqual(old)
  expect(p.store.calls).toBe(2)
 })
 it('When OpenCode monthly has no known cycle Then selection uses cycleSeconds, not the key name',()=>{
  const r=buildAlertReport('opencode',JSON.stringify({usage:{monthly:{percent:90,resetsAt:null},weekly:{percent:10,resetsAt:'2026-11-21T00:00:00Z'}}}),start,[])
  expect(r?.primaryId).toBe('weekly')
 })
})
