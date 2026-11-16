import {describe,it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
const require=createRequire(import.meta.url)
const app=require('../../collector/ecosystem.config.cjs').apps[0]
describe('Given the reviewed collector PM2 declaration before D1 cutover',()=>{
 it('When started without a named environment Then keeps PG and grants quiesce longer than 30 seconds',()=>{
  expect(app.env.ZZIK_STORE).toBe('postgres');expect(app.env.ZZIK_INTERVAL_SEC).toBe('900');expect(app.kill_timeout).toBe(35000)
  expect(app.node_args).toEqual(['--env-file='+resolve('collector/../.env')])
 })
 it('When D1 is explicitly selected Then only non-secret switches enter PM2 config',()=>{
  expect(app.env_d1).toEqual({ZZIK_STORE:'d1',ZZIK_D1_AUTH:'wrangler-oauth',ZZIK_D1_OAUTH_PROFILE:'zzik-collector'})
  expect(app.env_postgres).toEqual({ZZIK_STORE:'postgres'})
  for(const env of [app.env,app.env_d1,app.env_postgres])for(const key of ['DB_URL','ZZIK_D1_ACCOUNT_ID','ZZIK_D1_DATABASE_ID','ZZIK_D1_API_TOKEN','ZZIK_ALERT_WEBHOOK_URL'])expect(Object.hasOwn(env,key)).toBe(false)
 })
 it('When Node reads a private env-file Then PM2 mode wins, IDs stay file-only and explicit PG rollback wins',()=>{
  const directory=mkdtempSync(join(tmpdir(),'cutover-env-')),envFile=join(directory,'.env')
  writeFileSync(envFile,'DB_URL=postgres://synthetic\nZZIK_STORE=d1\nZZIK_D1_AUTH=api-token\nZZIK_D1_OAUTH_PROFILE=human-profile\nZZIK_D1_ACCOUNT_ID=synthetic-account\nZZIK_D1_DATABASE_ID=synthetic-db\n',{mode:0o600})
  const moduleUrl=new URL('../../collector/domain/usage/storage-config.mjs',import.meta.url).href
  const code=`import {readStorageConfig} from ${JSON.stringify(moduleUrl)};const c=readStorageConfig(process.env);console.log(JSON.stringify({ok:c.ok,mode:c.ok?c.mode:null,profile:c.ok?c.oauthProfile:null,idsFromFile:process.env.ZZIK_D1_ACCOUNT_ID==='synthetic-account'&&process.env.ZZIK_D1_DATABASE_ID==='synthetic-db',auth:process.env.ZZIK_D1_AUTH}))`
  const run=(extra:Record<string,string>)=>{const result=spawnSync(process.execPath,['--env-file='+envFile,'--input-type=module','-e',code],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,HOME:process.env.HOME,...app.env,...extra}});expect(result.status).toBe(0);return JSON.parse(result.stdout)}
  try{
   expect(run({})).toMatchObject({ok:true,mode:'postgres',idsFromFile:true})
   expect(run(app.env_d1)).toMatchObject({ok:true,mode:'d1',profile:'zzik-collector',auth:'wrangler-oauth',idsFromFile:true})
   expect(run({...app.env_d1,...app.env_postgres})).toMatchObject({ok:true,mode:'postgres',idsFromFile:true})
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
