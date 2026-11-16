import {describe,it,expect} from 'vitest'
import {createCollectorNotice} from '../../../../collector/infra/usage/collector-notice.mjs'
describe('Given an operational notice sink with injected transport',()=>{
 it('When the reason contains the D1 prefix Then retains the safe identifier while rejecting URLs',async()=>{
  const logs:string[]=[],bodies:string[]=[]
  const notice=createCollectorNotice({webhookUrl:'https://synthetic.invalid',log:line=>logs.push(line),fetchImpl:async(_url,init)=>{bodies.push(String(init?.body));return new Response(null,{status:204})}})
  await notice.notify({reason:'d1_export_read_failed'});expect(logs[0]).toContain('reason=d1_export_read_failed');expect(bodies[0]).toContain('reason=d1_export_read_failed')
  await notice.notify({reason:'postgres://synthetic-secret'});expect(logs[1]).toContain('reason=collector_error');expect(bodies[1]).not.toContain('synthetic-secret')
 })
})
