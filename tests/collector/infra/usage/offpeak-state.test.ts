import{describe,it,expect}from'vitest'
import{mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,readdirSync}from'node:fs'
import{join}from'node:path'
import{tmpdir}from'node:os'
import{createOffpeakState}from'../../../../collector/infra/usage/offpeak-state.mjs'
describe('Given a private off-peak state file',()=>{
 it('When missing, saved or corrupt Then preserves claims atomically and never silently resets corrupt JSON',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'offpeak-state-')),path=join(directory,'state.json'),state=createOffpeakState({path})
  try{
   expect(await state.read()).toBeNull();await state.write({v:1,keys:{synthetic:123}})
   expect(await state.read()).toEqual({v:1,keys:{synthetic:123}});expect(statSync(path).mode&0o777).toBe(0o600)
   expect(readdirSync(directory)).toEqual(['state.json']);expect(readFileSync(path,'utf8')).not.toContain('token')
   writeFileSync(path,'bad json');await expect(state.read()).rejects.toThrow('OffpeakStateUnavailable')
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
