import {describe,it,expect} from 'vitest'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createWranglerOAuthFile} from '../../../../collector/infra/usage/wrangler-oauth-file.mjs'
describe('Given a private fake Wrangler OAuth file',()=>{
 it('When expiring a rejected token Then preserves every credential field and changes only expiry atomically',()=>{
  const directory=mkdtempSync(join(tmpdir(),'oauth-file-')),path=join(directory,'default.toml')
  const raw='oauth_token = "synthetic-access"\nrefresh_token = "synthetic-refresh"\nexpiration_time = "2099-01-01T00:00:00Z"\nscopes = ["d1:write"]\n'
  try{writeFileSync(path,raw,{mode:0o600});const f=createWranglerOAuthFile({path});expect(f.read()).toMatchObject({ok:true,value:{token:'synthetic-access'}});expect(f.expire('another-token').ok).toBe(false);expect(readFileSync(path,'utf8')).toBe(raw);expect(f.expire('synthetic-access').ok).toBe(true);expect(readFileSync(path,'utf8')).toBe(raw.replace('2099-01-01T00:00:00Z','2000-01-01T00:00:00.000Z'));expect(statSync(path).mode&0o777).toBe(0o600)}finally{rmSync(directory,{recursive:true,force:true})}
 })
 it('When the file is missing, malformed or has duplicate/invalid expiry fields Then fails without exposing raw text',()=>{
  const directory=mkdtempSync(join(tmpdir(),'oauth-invalid-')),path=join(directory,'auth.toml'),f=createWranglerOAuthFile({path})
  try{expect(f.read().ok).toBe(false);for(const text of ['synthetic-secret','oauth_token = "synthetic-secret"','oauth_token = "synthetic-secret"\nexpiration_time = "broken"','oauth_token = "one"\noauth_token = "two"\nexpiration_time = "2099-01-01T00:00:00Z"']){writeFileSync(path,text);const r=f.read();expect(r.ok).toBe(false);expect(JSON.stringify(r)).not.toContain('synthetic-secret')}}finally{rmSync(directory,{recursive:true,force:true})}
 })
})

import {createWranglerOAuthCredentials} from '../../../../collector/app/usage/d1-oauth-credentials.mjs'
import {createWranglerOAuthRefresh} from '../../../../collector/infra/usage/wrangler-oauth-refresh.mjs'
import {createD1RestClient} from '../../../../collector/infra/usage/d1-rest-client.mjs'
import {fakeD1Control} from '../../../fakes/d1-control'
describe('Given a real temporary OAuth file and fake Wrangler/fetch executors',()=>{
 it('When REST returns 401 Then forces metadata expiry, refreshes once, rereads and sends the same batch with new credentials',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'oauth-rest-')),path=join(directory,'auth.toml');let calls=0,refreshes=0,now=0
  const raw='oauth_token = "old-synthetic"\nrefresh_token = "synthetic-refresh"\nexpiration_time = "2099-01-01T00:00:00Z"\n'
  writeFileSync(path,raw,{mode:0o600})
  try{
   const clock={now:()=>now},file=createWranglerOAuthFile({path}),control=fakeD1Control()
   const credentials=createWranglerOAuthCredentials({file,clock,refresh:createWranglerOAuthRefresh({execute:async args=>{expect(args).toEqual(['whoami','--json']);expect(readFileSync(path,'utf8')).toContain('2000-01-01');writeFileSync(path,raw.replace('old-synthetic','new-synthetic'));refreshes++;return 0}})})
   const client=createD1RestClient({mode:'d1',dryRun:false,accountId:'fake',databaseId:'fake',control,clock,credentials,wait:async ms=>{now+=ms},fetch:async(_url,init)=>{calls++;expect(init.headers.Authorization).toBe(calls===1?'Bearer old-synthetic':'Bearer new-synthetic');return {status:calls===1?401:200,headers:{get:()=>null},json:async()=>({success:true,result:[{success:true}]})}}})
   expect((await client.query([{sql:'SELECT 1',params:[]}])).ok).toBe(true);expect(calls).toBe(2);expect(refreshes).toBe(1);expect(JSON.stringify(control.read())).not.toContain('synthetic')
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
