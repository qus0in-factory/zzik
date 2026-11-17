import { describe, it, expect } from 'vitest'
import { parseAgyModels, parseClaudeModels, parseGrokModels, planStatement } from '../../../../collector/domain/trend/plan-models.mjs'

describe('Given authenticated model lists', () => {
 it('When tab rows contain effort variants Then IDs are deduplicated and empty output fails', () => {
  expect(parseAgyModels('gemini-4-high\tGemini 4 High\ngemini-4-low\tGemini 4 Low\n')).toEqual({ok:true,value:[{id:'gemini-4',name:'Gemini 4'}]})
  expect(parseAgyModels('')).toEqual({ok:false,reason:'empty_models'})
 })
 it('When a Claude window has model scope Then only model identity is extracted', () => {
  expect(parseClaudeModels(JSON.stringify({seven_day_fable:{utilization:99,scope:{model:{id:'claude-fable-1',display_name:'Fable'}}},seven_day:{utilization:20}}))).toEqual({ok:true,value:[{id:'claude-fable-1',name:'Fable'}]})
 })
 it('When legacy windows lack a model scope Then names are not inferred',()=>{
  expect(parseClaudeModels(JSON.stringify({seven_day_fable:{utilization:12},seven_day_oauth_apps:{utilization:10}}))).toEqual({ok:false,reason:'empty_models'})
 })
 it('When Claude has only a display name Then a normalized partial identity retains the display name',()=>{
  expect(parseClaudeModels(JSON.stringify({limits:[{kind:'weekly_scoped',scope:{model:{display_name:'  ＦａＢｌｅ  \t 4  '}}},{kind:'weekly_scoped',scope:{model:{display_name:'fable 4'}}}]}))).toEqual({ok:true,value:[{id:'claude-display:fable 4',name:'ＦａＢｌｅ 4',confidence:'partial'}]})
 })
 it('When Grok returns a model list Then only validated identity and partial confidence are kept',()=>{
  expect(parseGrokModels(JSON.stringify({data:[{id:'grok-4.7',secret:'discard'},{id:'other-model-1'},{id:'grok-4.7'}]}))).toEqual({ok:true,value:[{id:'grok-4.7',name:'grok-4.7',confidence:'partial'},{id:'other-model-1',name:'other-model-1',confidence:'partial'}]})
  expect(parseGrokModels(JSON.stringify({data:[{id:'   '}]}))).toEqual({ok:false,reason:'invalid_models'})
  expect(parseGrokModels(JSON.stringify({data:[]}))).toEqual({ok:false,reason:'empty_models'})
 })
 it('When scoped limits contain a model and a surface Then only the model is observed',()=>{
  expect(parseClaudeModels(JSON.stringify({limits:[{kind:'weekly_scoped',scope:{model:{id:'claude-fable-1',display_name:'Fable'}}},{kind:'weekly_scoped',scope:{surface:'Cowork'}}]}))).toEqual({ok:true,value:[{id:'claude-fable-1',name:'Fable'}]})
 })
 it('When constructing a batch Then baseline and first observation are preserved on duplicate', () => {
  const s=planStatement('antigravity','agy-cli',[{id:'one',name:'One'},{id:'two',name:'Two'}],Date.parse('2026-11-17T15:00:00Z'))
  expect(s.sql).toContain('NOT EXISTS')
  expect(s.sql).toContain('DO UPDATE SET last_seen_at=excluded.last_seen_at')
  expect(s.params).toContain(Date.parse('2026-11-17T15:00:00Z'))
 })
})

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
describe('Given a plan observed around Seoul midnight',()=>{
 it('When the first batch and subsequent batches are upserted Then baseline and first seen remain intact',()=>{
  const db=new DatabaseSync(':memory:')
  db.exec(readFileSync('worker/migrations/0003-trend-plan-observation.sql','utf8'))
  const apply=(ids:string[],at:number)=>{const statement=planStatement('antigravity','agy-cli',ids.map(id=>({id,name:id})),at);db.prepare(statement.sql).run(...statement.params)}
  const before=Date.parse('2026-11-17T14:59:59.999Z'), midnight=Date.parse('2026-11-17T15:00:00Z'), after=midnight+1
  apply(['a','b'],before);apply(['a','c'],midnight);apply(['c'],after)
  const rows=db.prepare('SELECT model_id,first_seen_at,last_seen_at,baseline FROM trend_plan_observation ORDER BY model_id').all()
  expect(rows.map(row=>({...row}))).toEqual([{model_id:'a',first_seen_at:before,last_seen_at:midnight,baseline:1},{model_id:'b',first_seen_at:before,last_seen_at:before,baseline:1},{model_id:'c',first_seen_at:midnight,last_seen_at:after,baseline:0}])
  db.close()
 })
})

describe('Given mixed observation confidence',()=>{
 it('When inserting parsed models Then confidence and display name reach the store',()=>{
  const db=new DatabaseSync(':memory:'); db.exec(readFileSync('worker/migrations/0003-trend-plan-observation.sql','utf8'))
  const s=planStatement('claude-max','usage-keys',[{id:'claude-display:fable',name:'Fable',confidence:'partial'},{id:'claude-1',name:'Claude',confidence:'account'}],0);db.prepare(s.sql).run(...s.params)
  expect(db.prepare('SELECT model_id,display_name,confidence FROM trend_plan_observation ORDER BY model_id').all().map(row=>({...row}))).toEqual([{model_id:'claude-1',display_name:'Claude',confidence:'account'},{model_id:'claude-display:fable',display_name:'Fable',confidence:'partial'}]);db.close()
 })
})
