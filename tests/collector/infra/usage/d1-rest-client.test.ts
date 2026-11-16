import {fakeD1Control} from '../../../fakes/d1-control'
import {describe,it,expect} from 'vitest'
import {createD1RestClient} from '../../../../collector/infra/usage/d1-rest-client.mjs'
const statement={sql:'SELECT 1',params:[]}
function fixture(responses:unknown[]=[{success:true,result:[{success:true,results:[]}]}],status=200,retry:string|null=null){
 let now=0;const calls:Array<{body:string;signal:AbortSignal}>=[];const waits:number[]=[]
 const client=createD1RestClient({mode:'d1',dryRun:false,control:fakeD1Control(),accountId:'fake-account',databaseId:'fake-db',token:'fake-token',clock:{now:()=>now},wait:async(ms:number)=>{waits.push(ms);now+=ms},fetch:async(_url:string,init:{body:string;signal:AbortSignal})=>{calls.push(init);return {status,headers:{get:()=>retry},json:async()=>responses.shift()}}})
 return {client,calls,waits}
}
describe('Given a fake D1 REST endpoint and a single request lane',()=>{
 it('When HTTP 200 has partial, missing or malformed statement results Then never acknowledges',async()=>{
  for(const body of [{success:true,result:[{success:false}]},{success:true,result:[]},{success:false,result:[{success:true}]},null]){
   const h=fixture([body]);expect((await h.client.query([statement])).ok).toBe(false)
  }
 })
 it('When requests overlap Then serializes them and enforces at least one second between starts',async()=>{
  const h=fixture([{success:true,result:[{success:true}]},{success:true,result:[{success:true}]}])
  await Promise.all([h.client.query([statement]),h.client.query([statement])])
  expect(h.calls).toHaveLength(2);expect(h.waits).toEqual([1000])
  expect(JSON.parse(h.calls[0].body)).toEqual({batch:[statement]})
  expect(h.calls[0].signal).toBeInstanceOf(AbortSignal)
 })
 it('When 401/403 occurs Then stops all later requests until a new credential client is created',async()=>{
  for(const status of [401,403]){const h=fixture([],status);expect(await h.client.query([statement])).toMatchObject({ok:false,reason:'auth'});await h.client.query([statement]);expect(h.calls).toHaveLength(1);expect(h.client.authStopped()).toBe(true)}
 })
 it('When 429, 5xx or 400 occurs Then preserves retry versus provider-invalid classification',async()=>{
  expect(await fixture([],429,'60').client.query([statement])).toMatchObject({ok:false,reason:'retry',retryAfterMs:60000})
  expect(await fixture([],503).client.query([statement])).toMatchObject({ok:false,reason:'retry'})
  expect(await fixture([],400).client.query([statement])).toMatchObject({ok:false,reason:'invalid'})
 })
 it('When D1 rate limits the lane Then maintenance and all later queries also respect Retry-After',async()=>{
  const h=fixture([],429,'60');await h.client.query([statement]);await h.client.query([statement]);expect(h.waits).toEqual([60000])
 })
 it('When restarted with the same rejected credential Then stays stopped; a rotated token can resume',async()=>{
  const control=fakeD1Control();let now=0,calls=0
  const options={mode:'d1',dryRun:false,control,accountId:'fake',databaseId:'fake',token:'old-fake',clock:{now:()=>now},wait:async(ms:number)=>{now+=ms},fetch:async()=>{calls++;return {status:calls===1?403:200,headers:{get:()=>null},json:async()=>({success:true,result:[{success:true}]})}}}
  await createD1RestClient(options).query([statement]);await createD1RestClient(options).query([statement]);expect(calls).toBe(1)
  expect((await createD1RestClient({...options,token:'rotated-fake'}).query([statement])).ok).toBe(true);expect(calls).toBe(2)
 })
 it('When JSON decoding fails Then honors the response Retry-After without leaking its body',async()=>{
  const c=createD1RestClient({mode:'d1',dryRun:false,control:fakeD1Control(),accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>0},wait:async()=>{},fetch:async()=>({status:200,headers:{get:()=> '60'},json:async()=>{throw Error('synthetic invalid json')}})})
  expect(await c.query([statement])).toMatchObject({ok:false,reason:'retry',retryAfterMs:60000})
 })
 it('When the fetch or body hangs Then aborts and retries after the fixed fifteen-second deadline',async()=>{
  let signal:AbortSignal|undefined
  const c=createD1RestClient({mode:'d1',dryRun:false,control:fakeD1Control(),accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>Date.now()},wait:async()=>{},fetch:async(_url,init)=>{signal=init.signal;return new Promise(()=>{})}})
  expect(await c.query([statement])).toMatchObject({ok:false,reason:'retry'});expect(signal?.aborted).toBe(true)
 },20000)
 it('When shutdown begins while a request waits for its lane Then never starts that queued HTTP',async()=>{
  let allowed=true,calls=0,release!:()=>void;const control=fakeD1Control()
  const client=createD1RestClient({mode:'d1',dryRun:false,control,canRequest:()=>allowed,accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>0},wait:async()=>new Promise<void>(r=>{release=r}),fetch:async()=>{calls++;return {status:200,headers:{get:()=>null},json:async()=>({success:true,result:[{success:true}]})}}})
  await client.query([statement]);const queued=client.query([statement]);for(let i=0;i<5;i++)await Promise.resolve();allowed=false;release();expect(await queued).toMatchObject({ok:false,reason:'disabled'});expect(calls).toBe(1)
 })
 it('When postgres or dry-run is selected Then performs zero remote I/O',async()=>{
  for(const [mode,dryRun] of [['postgres',false],['d1',true]] as const){let calls=0;const c=createD1RestClient({mode,dryRun,control:fakeD1Control(),accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>0},wait:async()=>{},fetch:async()=>{calls++;throw Error('must not send')}});expect((await c.query([statement])).ok).toBe(false);expect(calls).toBe(0)}
 })
})
