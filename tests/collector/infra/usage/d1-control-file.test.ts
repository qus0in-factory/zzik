import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createD1ControlFile} from '../../../../collector/infra/usage/d1-control-file.mjs'
import {successValue} from '../../../fakes/d1-contract'
describe('Given a credential-free sender control sidecar under the locked state directory',()=>{
 it('When restarted Then preserves stop flags and request spacing; corrupt content fails closed',()=>{
  const d=mkdtempSync(join(tmpdir(),'zzik-b2-control-')),path=join(d,'d1-sender-control.json')
  try{
   const first=createD1ControlFile({path});const state=successValue(first.read())
   successValue(first.write({...state,credentialKey:'a'.repeat(64),authStopped:true,nextRequestAtMs:123,paused:{claude:'operation'}}))
   expect(successValue(createD1ControlFile({path}).read())).toMatchObject({authStopped:true,nextRequestAtMs:123,paused:{claude:'operation'}})
   expect(statSync(path).mode&0o777).toBe(0o600)
   writeFileSync(path,'broken');expect(createD1ControlFile({path}).read().ok).toBe(false)
  }finally{rmSync(d,{recursive:true,force:true})}
 })
})
