import {describe,it,expect} from 'vitest'
import {createGrokModelsClient} from '../../../../collector/infra/trend/grok-models-client.mjs'

describe('Given Grok Build model discovery',()=>{
 it('When credentials are valid Then it uses the existing secure request path',async()=>{
  let url='',options:RequestInit|undefined
  const fetchImpl:typeof fetch=async(input,init)=>{url=String(input);options=init;return new Response(JSON.stringify({data:[{id:'grok-4.7'}]}),{status:200})}
  const client=createGrokModelsClient({fetchImpl,readCredentials:async()=>({source:'file',token:'synthetic',expiresAt:null}),nowMs:()=>0})
  expect(await client.read()).toContain('grok-4.7');expect(url).toBe('https://cli-chat-proxy.grok.com/v1/models');expect(options?.redirect).toBe('manual');expect(options?.headers).toMatchObject({Authorization:'Bearer synthetic','X-XAI-Token-Auth':'xai-grok-cli','x-grok-client-version':'1.0.0'})
 })
 it('When credentials are expired or response is a redirect Then no body is returned',async()=>{
  let calls=0; const fetchImpl:typeof fetch=async()=>{calls++;return new Response('secret',{status:302})}
  expect(await createGrokModelsClient({fetchImpl,readCredentials:async()=>({source:'file',token:'synthetic',expiresAt:60000}),nowMs:()=>0}).read()).toBeNull();expect(calls).toBe(0)
  expect(await createGrokModelsClient({fetchImpl,readCredentials:async()=>({source:'file',token:'synthetic',expiresAt:null}),nowMs:()=>0}).read()).toBeNull();expect(calls).toBe(1)
 })
})
