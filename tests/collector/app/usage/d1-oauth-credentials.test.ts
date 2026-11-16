import {describe,it,expect} from 'vitest'
import {createWranglerOAuthCredentials} from '../../../../collector/app/usage/d1-oauth-credentials.mjs'
describe('Given Wrangler OAuth credentials behind file and refresh ports',()=>{
 it('When several providers see impending expiry Then refreshes globally once and rereads the stored token',async()=>{
  let token='old-synthetic',expiresAtMs=500,refreshes=0,active=0,max=0
  const file={read:()=>({ok:true as const,value:{token,expiresAtMs}}),expire:()=>({ok:true as const,value:undefined})}
  const options={file,clock:{now:()=>0},refresh:{run:async()=>{active++;max=Math.max(max,active);refreshes++;await Promise.resolve();token='new-synthetic';expiresAtMs=3600000;active--;return {ok:true as const,value:undefined}}}}
  const a=createWranglerOAuthCredentials(options),b=createWranglerOAuthCredentials(options)
  const results=await Promise.all([a.get(),b.get(),a.get()]);expect(results.every(r=>r.ok&&r.value.token==='new-synthetic')).toBe(true);expect(refreshes).toBe(1);expect(max).toBe(1)
  expect(await a.refresh('old-synthetic')).toMatchObject({ok:true,value:{token:'new-synthetic'}});expect(refreshes).toBe(1)
 })
 it('When concurrent refresh attempts fail Then shares that one failure rather than launching another process',async()=>{
  let calls=0
  const options={clock:{now:()=>0},file:{read:()=>({ok:true as const,value:{token:'expired-synthetic',expiresAtMs:0}}),expire:()=>({ok:true as const,value:undefined})},refresh:{run:async()=>{calls++;await Promise.resolve();return {ok:false as const,reason:'failed'}}}}
  const a=createWranglerOAuthCredentials(options),b=createWranglerOAuthCredentials(options)
  const results=await Promise.all([a.get(),b.get()]);expect(results.every(r=>!r.ok)).toBe(true);expect(calls).toBe(1)
 })
 it('When a valid token gets a 401 Then forces expiry before one refresh and rejects an unchanged token',async()=>{
  let expired=false,refreshes=0
  const c=createWranglerOAuthCredentials({file:{read:()=>({ok:true,value:{token:'unchanged-synthetic',expiresAtMs:3600000}}),expire:token=>{expect(token).toBe('unchanged-synthetic');expired=true;return {ok:true,value:undefined}}},clock:{now:()=>0},refresh:{run:async()=>{expect(expired).toBe(true);refreshes++;return {ok:true,value:undefined}}}})
  expect((await c.get()).ok).toBe(true);expect((await c.refresh('unchanged-synthetic')).ok).toBe(false);expect(refreshes).toBe(1)
 })
 it('When read, expiry update or refresh fails Then returns a safe failure without credentials or exception text',async()=>{
  for(const at of ['read','expire','refresh']){
   const fail=()=>{throw Error('synthetic-secret')}
   const c=createWranglerOAuthCredentials({clock:{now:()=>0},file:{read:()=>at==='read'?fail():{ok:true,value:{token:'synthetic-secret',expiresAtMs:0}},expire:()=>at==='expire'?fail():{ok:true,value:undefined}},refresh:{run:async()=>at==='refresh'?fail():{ok:true,value:undefined}}})
   const r=await c.get();expect(r).toEqual({ok:false,reason:'oauth_credentials_unavailable'});expect(JSON.stringify(r)).not.toContain('synthetic-secret')
  }
 })
})
