import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {createD1Resident} from '../../../../collector/app/usage/d1-resident.mjs'
import {fakeD1Control} from '../../../fakes/d1-control'
import {D1_NOW,D1_OPERATION_ID,successValue} from '../../../fakes/d1-contract'
import type {D1QueryResult} from '../../../../collector/domain/usage/d1-sender-types'
describe('Given D1 runtime ports without operational credentials',()=>{
 it('When shutdown arrives during upstream and HTTP Then accepts the finished observation before closing and starts no new HTTP',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-b3-runtime-')),now=Date.parse(D1_NOW)
  const ledger=successValue(openSqliteLedger({directory,nowMs:now}))
  let upstream!:()=>void,http!:()=>void,entered!:()=>void,httpCalls=0,done=false
  const enteredPromise=new Promise<void>(r=>{entered=r});const scheduled:number[]=[]
  const query={authStopped:()=>false,query:async():Promise<D1QueryResult>=>{httpCalls++;await new Promise<void>(r=>{http=r});return {ok:true,value:[{results:[]},{results:[]}]}}}
  const runtime=createD1Resident({ledger,query,control:fakeD1Control(),clock:{now:()=>now},timer:{schedule:(ms:number)=>{scheduled.push(ms);return ()=>{}}},random:()=>0,operationId:()=>D1_OPERATION_ID,notice:{notify:async()=>{}},notifyAlerts:async()=>{},intervals:{claude:900},retentionDays:30,collectorVersion:'test',providers:[{id:'claude',ports:{clock:{now:()=>now},credentials:{readAll:async()=>[{source:'fake',token:'fake',expiresAt:null}]},usage:{fetchUsage:async()=>{entered();await new Promise<void>(r=>{upstream=r});return {ok:true,bodyText:'{"five_hour":{"utilization":37}}',httpStatus:200,retryAfterSec:null}}},store:{write:async()=>{throw Error('PG forbidden')}},state:{read:async()=>null,write:async()=>{throw Error('JSON forbidden')}},logger:{write:async()=>{}}}}]})
  try{
   runtime.start();await enteredPromise;const stop=runtime.shutdown().then(x=>{done=true;return x});runtime.pump();expect(done).toBe(false);expect(scheduled).toContain(30000)
   upstream();for(let i=0;i<20;i++)await Promise.resolve();expect(done).toBe(false);http();expect(await stop).toEqual({timedOut:false});expect(httpCalls).toBe(1)
   const reopened=successValue(openSqliteLedger({directory,nowMs:now}));try{expect(successValue(reopened.read('claude')).rows).toHaveLength(1)}finally{reopened.close()}
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })
})
