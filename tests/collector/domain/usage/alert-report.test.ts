import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAlertReport } from '../../../../collector/domain/usage/alert-report.mjs'
import { barLevelOf } from '../../../../src/domain/usage/bar-level'
import { elapsedPercent } from '../../../../src/domain/usage/elapsed'
import { barLevelOf as sharedBar, elapsedPercent as sharedElapsed } from '../../../../shared/usage-policy.ts'
import { buildUsageLoadView } from '../../../../src/app/usage/load-usage'
import { summaryPaceOf } from '../../../../src/app/usage/summary-pace'
import type { UsageProvider } from '../../../../shared/usage-contract'
const dir = new URL('../../../fixtures/',import.meta.url)
const files = readdirSync(dir).filter(f=>/^(claude|codex|antigravity|opencode|grok|ollama)-(usage|cli-quota).*\.json$/.test(f))
const now = new Date('2026-11-11T12:00:00Z')
describe('Given shared dashboard and collector alert policies',()=>{
  it('When card policies are imported Then both consumers execute the same functions',()=>{
    expect(barLevelOf).toBe(sharedBar)
    expect(elapsedPercent).toBe(sharedElapsed)
  })
  it.each(files)('When %s is parsed Then alert values and primary pace selection match cards',file=>{
    const provider=file.split('-')[0] as UsageProvider, text=readFileSync(new URL(file,dir),'utf8'), raw=JSON.parse(text)
    const alert=buildAlertReport(provider,text,now.getTime(),[])
    const report=buildUsageLoadView({usage:raw,collection:{schema:1,provider,status:'ok',called:true,runAt:now.toISOString(),fetchedAt:now.toISOString(),httpStatus:200,retryAt:null,tokenExpiresAt:null,kvTokenExpiresAt:null,intervalSec:900,collectorVersion:'test',rawOmitted:null},rawText:null},now,provider).report
    if(alert===null){expect(report.issues.length).toBeGreaterThan(0);return}
    expect(alert.limits.map(w=>({id:w.id,label:w.label,usedPercent:w.usedPercent,elapsedPercent:w.elapsedPercent}))).toEqual([...report.windows,...report.metrics].filter(w=>provider!=='claude'||w.id!=='extra_usage').map(w=>({id:w.id,label:w.label,usedPercent:w.usedPercent,elapsedPercent:w.elapsedPercent})))
    const pace=summaryPaceOf(report.windows,provider)
    if(pace!==null){const chosen=alert.limits.find(w=>w.id===alert.primaryId);expect(chosen?.usedPercent).toBe(pace.usedPercent);expect(chosen?.elapsedPercent).toBe(pace.elapsedPercent)}
  })
})
