import { describe, expect, it } from 'vitest'
import live from '../../fixtures/claude-usage.live-scoped.json'
import { buildUsageView } from '@domain/usage/view'
import { visibleUsageReport } from '@domain/usage/visible'
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts'
import { extraSpendPresentation } from '@app/usage/extra-spend'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract'
const now=new Date('2026-11-12T12:00:00Z')
const raw=(utilization:unknown=100)=>({...live,extra_usage:{is_enabled:false,spend_limit_reached:true,utilization,monthly_limit:123456,used_credits:234567,currency:'TEST',decimal_places:2}})
describe('Given Claude additional spend, separate from subscription quotas',()=>{
 it('When spending reaches its cap Then retains status metadata without a quota or other entry',()=>{
  const report=buildUsageView(raw(),{now})
  expect([...report.windows,...report.metrics,...report.others].map(w=>w.id)).not.toContain('extra_usage')
  expect(report.extraSpend).toEqual({enabled:false,limitReached:true,usedPercent:100})
  expect(buildUsageView({extra_usage:raw().extra_usage},{now}).status).toBe('unknown')
  expect(report.raw).toEqual(raw())
 })
 it('When utilization is null, zero, or malformed Then distinguishes no information from actual zero',()=>{
  for(const value of [null,'100',false,-1]) expect(buildUsageView(raw(value),{now}).extraSpend?.usedPercent).toBeNull()
  expect(extraSpendPresentation(buildUsageView(raw(null),{now}).extraSpend)?.detail).toBe('정보 없음')
  expect(extraSpendPresentation(buildUsageView(raw(0),{now}).extraSpend)?.detail).toBe('소진율 0%')
 })
 it('When amount units are not contractually verified Then never formats the amount or currency',()=>{
  const view=extraSpendPresentation(buildUsageView(raw(),{now}).extraSpend)
  expect(view?.badges.map(b=>b.text)).toEqual(['비활성','지출 한도 도달'])
  expect(view?.detail).toBe('소진율 100%')
  expect(JSON.stringify(view)).not.toMatch(/123456|234567|TEST/)
 })
 it('When redacted metadata exists Then hides the financial row or only its hidden fields',()=>{
  const report=buildUsageView(raw(),{now})
  expect(visibleUsageReport(report,['extra_usage']).extraSpend).toBeNull()
  expect(visibleUsageReport(report,['extra_usage.utilization','extra_usage.is_enabled']).extraSpend).toEqual({enabled:null,limitReached:true,usedPercent:null})
 })
 it('When scanning additional spend Then it is not a percentage series, even when malformed',()=>{
  for(const value of [100,null,'bad']) expect(scanUsageSeries('claude',{extra_usage:{utilization:value}},{fetchedAt:now.toISOString(),rawRedacted:[]})).toEqual({ok:true,skipped:0,series:[]})
  expect(USAGE_HISTORY_SCAN_VERSION).toBe(2)
 })
})
