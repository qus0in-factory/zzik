import {describe,it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {readStorageConfig} from '../../collector/domain/usage/storage-config.mjs'
const app=createRequire(import.meta.url)('../../collector/ecosystem.config.cjs').apps[0]
const capability={v:1,readStore:'d1',bucketRoute:true}
describe('Given the G-stage default D1 PM2 declaration',()=>{
 it('When using the default environment Then keeps five180/Claude900 and private credentials outside PM2',()=>{
  expect(app.env.ZZIK_STORE).toBe('d1');expect(app.kill_timeout).toBe(35000)
  expect(app.env_postgres).toBeUndefined();expect(app.env_d1).toBeUndefined()
  expect(readStorageConfig(app.env,{dryRun:true,capability})).toMatchObject({ok:true,mode:'d1',intervals:{claude:900,codex:180,antigravity:180,opencode:180,grok:180,ollama:180}})
  for(const key of ['DB_URL','ZZIK_D1_ACCOUNT_ID','ZZIK_D1_DATABASE_ID','ZZIK_D1_API_TOKEN','ZZIK_ALERT_WEBHOOK_URL'])expect(Object.hasOwn(app.env,key)).toBe(false)
 })
 it('When capability is missing Then default short intervals fail closed',()=>{
  expect(readStorageConfig(app.env,{dryRun:true})).toEqual({ok:false,reason:'InvalidProviderInterval'})
 })
})
