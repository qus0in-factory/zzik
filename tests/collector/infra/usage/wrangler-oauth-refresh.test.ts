import {spawnSync} from 'node:child_process'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe,it,expect} from 'vitest'
import {isAbsolute} from 'node:path'
import {createWranglerOAuthRefresh} from '../../../../collector/infra/usage/wrangler-oauth-refresh.mjs'
describe('Given a captured fake Wrangler refresh process',()=>{
 it('When invoked Then uses an absolute executable/script/cwd and the explicit collector profile environment',async()=>{
  let seen:any
  const r=await createWranglerOAuthRefresh({profile:'zzik-collector',env:{HOME:'/synthetic-home',PATH:'/synthetic-bin',CLOUDFLARE_AUTH_PROFILE:'human-profile',CLOUDFLARE_ACCOUNT_ID:'synthetic-account',CF_ACCOUNT_ID:'synthetic-account',DISCORD_WEBHOOK_URL:'synthetic-secret',DB_URL:'synthetic-secret'},execute:async request=>{seen=request;return 0}}).run()
  expect(r.ok).toBe(true);expect(isAbsolute(seen.file)).toBe(true);expect(isAbsolute(seen.args[0])).toBe(true);expect(seen.args[0]).toMatch(/node_modules\/wrangler\/bin\/wrangler.js$/);expect(seen.args.slice(1)).toEqual(['whoami','--json']);expect(isAbsolute(seen.cwd)).toBe(true)
  expect(seen.env).toMatchObject({CLOUDFLARE_AUTH_PROFILE:'zzik-collector',CLOUDFLARE_AUTH_USE_KEYRING:'false',CI:'true',HOME:'/synthetic-home'});expect(JSON.stringify(seen.env)).not.toContain('synthetic-secret');expect(seen.env.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();expect(seen.env.CF_ACCOUNT_ID).toBeUndefined()
 })
 it('When execution fails or an unsafe/default profile is selected Then returns only a safe failure',async()=>{
  expect(await createWranglerOAuthRefresh({execute:async()=>{throw Error('synthetic-secret')}}).run()).toEqual({ok:false,reason:'oauth_refresh_failed'})
  expect((await createWranglerOAuthRefresh({execute:async()=>1}).run()).ok).toBe(false)
  for(const profile of ['default','staging','../default','']){let calls=0;expect((await createWranglerOAuthRefresh({profile,execute:async()=>{calls++;return 0}}).run()).ok).toBe(false);expect(calls).toBe(0)}
 })
})

describe('Given a PM2-like caller outside the repository cwd',()=>{
 it('When constructing refresh Then the fake process receives this module repository script and cwd',()=>{
  const directory=mkdtempSync(join(tmpdir(),'oauth-refresh-cwd-'))
  try{
   const moduleUrl=new URL('../../../../collector/infra/usage/wrangler-oauth-refresh.mjs',import.meta.url).href
   const expectedScript=fileURLToPath(new URL('../../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),expectedCwd=fileURLToPath(new URL('../../../../',import.meta.url))
   const code=`import {createWranglerOAuthRefresh} from ${JSON.stringify(moduleUrl)};let matched=false;const r=await createWranglerOAuthRefresh({execute:async request=>{matched=request.args[0]===${JSON.stringify(expectedScript)}&&request.cwd===${JSON.stringify(expectedCwd)}&&request.env.CLOUDFLARE_AUTH_PROFILE==='zzik-collector';return 0}}).run();console.log(JSON.stringify({ok:r.ok&&matched}))`
   const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000});expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual({ok:true})
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
