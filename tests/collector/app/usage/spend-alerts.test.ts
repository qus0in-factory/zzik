import { describe, expect, it } from 'vitest'
import { buildAlertReport } from '../../../../collector/domain/usage/alert-report.mjs'
import { diffAlerts, nextAlertState } from '../../../../collector/app/usage/diff-alerts.mjs'
import { formatAlertMessage } from '../../../../collector/domain/usage/alert-message.mjs'
const now=Date.parse('2026-11-14T00:00:00Z')
const report=(reached:unknown,utilization:unknown=100,time=now)=>buildAlertReport('claude',JSON.stringify({five_hour:{utilization:10},extra_usage:{is_enabled:false,utilization,spend_limit_reached:reached,monthly_limit:123456,used_credits:234567,currency:'TEST'}}),time,[])!
describe('Given separate additional-spend alerts',()=>{
 it('When utilization reaches 100 Then excludes extra_usage from subscription limits',()=>{
  const r=report(false)
  expect(r.limits.map(w=>w.id)).toEqual(['five_hour'])
  expect(r.spendLimitReached).toBe(false)
  const prev=nextAlertState(null,report(false,0),[])
  expect(diffAlerts(prev,r)).toEqual([])
 })
 it('When the spend flag changes Then reports reach and clear once independently of utilization',()=>{
  let state=nextAlertState(null,report(false),[])
  const reached=diffAlerts(state,report(true))
  expect(reached).toMatchObject([{kind:'spend',id:'extra_usage',from:'normal',to:'limit'}])
  state=nextAlertState(state,report(true),reached)
  expect(diffAlerts(JSON.parse(JSON.stringify(state)),report(true))).toEqual([])
  const cleared=diffAlerts(state,report(false,null,now+900000))
  expect(cleared).toMatchObject([{kind:'spend',from:'limit',to:'normal'}])
  const message=formatAlertMessage([...reached,...cleared])
  expect(message).toContain('추가 지출 한도 도달')
  expect(message).toContain('추가 지출 한도 해제')
  for(const secret of ['123456','234567','TEST','100%']) expect(message).not.toContain(secret)
  expect(JSON.stringify(reached)).not.toMatch(/monthly_limit|used_credits|currency/)
 })
 it('When first loaded, upgraded from legacy state, or a flag is unknown Then does not manufacture a change',()=>{
  expect(diffAlerts(null,report(true))).toEqual([])
  const legacy={version:1 as const,primaryId:null,windows:{}}
  expect(diffAlerts(legacy,report(true))).toEqual([])
  const prev=nextAlertState(null,report(true),[])
  expect(diffAlerts(prev,report(null))).toEqual([])
  const unknown=nextAlertState(prev,report(null),[])
  expect(unknown.spendLimitReached).toBe(true)
  expect(diffAlerts(unknown,report(false))).toMatchObject([{kind:'spend',to:'normal'}])
 })
 it('When legacy generic extra_usage state exists Then does not send subscription recovery and removes that checkpoint',()=>{
  const r=report(false)
  const state=nextAlertState(null,r,[])
  state.windows.extra_usage={level:'limit',notifiedLevel:'limit',notifiedAt:now-3600000,usedPercent:100,resetsAt:null,cycleSeconds:null}
  const next={...r,limits:[...r.limits,{id:'extra_usage',label:'추가 사용량',usedPercent:0,elapsedPercent:null,resetsAt:null,cycleSeconds:null,expired:false}]}
  expect(diffAlerts(state,next)).toEqual([])
  expect(nextAlertState(state,next,[]).windows).not.toHaveProperty('extra_usage')
 })
})
