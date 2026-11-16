import {describe,it,expect} from 'vitest'
import {readIntervalPolicy} from '../../../../collector/domain/usage/interval-policy.mjs'
describe('Given explicit per-provider interval capability',()=>{
 it('When PG writes or capability is missing Then rejects every interval below 900 with exit 78',()=>{
  for(const mode of ['postgres','d1'] as const)for(const env of [{ZZIK_INTERVAL_SEC:'180'},{ZZIK_INTERVAL_SEC_OLLAMA:'180'}])expect(readIntervalPolicy(env,{mode,capability:null})).toMatchObject({ok:false,exitCode:78})
 })
 it('When valid capability is local Then permits only the selected provider at >=180',()=>{
  const capability={v:1,readStore:'d1',bucketRoute:true}
  expect(readIntervalPolicy({ZZIK_INTERVAL_SEC_OLLAMA:'180'},{mode:'d1',capability})).toMatchObject({ok:true,value:{ollama:180,claude:900,codex:900}})
  expect(readIntervalPolicy({ZZIK_INTERVAL_SEC_OLLAMA:'179'},{mode:'d1',capability})).toMatchObject({ok:false,exitCode:78})
  expect(readIntervalPolicy({ZZIK_INTERVAL_SEC_OLLAMA:'180'},{mode:'postgres',capability}).ok).toBe(false)
 })
})
