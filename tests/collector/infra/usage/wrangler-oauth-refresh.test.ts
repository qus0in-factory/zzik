import {describe,it,expect} from 'vitest'
import {createWranglerOAuthRefresh} from '../../../../collector/infra/usage/wrangler-oauth-refresh.mjs'
describe('Given a captured fake Wrangler refresh executor',()=>{
 it('When invoked Then runs one non-token-output command and converts errors to a safe failure',async()=>{
  for(const code of [0,1]){let calls=0;const r=await createWranglerOAuthRefresh({execute:async args=>{expect(args).toEqual(['whoami','--json']);calls++;return code}}).run();expect(r.ok).toBe(code===0);expect(calls).toBe(1)}
  expect(await createWranglerOAuthRefresh({execute:async()=>{throw Error('synthetic-secret')}}).run()).toEqual({ok:false,reason:'oauth_refresh_failed'})
 })
})
