import {spawnSync} from 'node:child_process'
import {describe,it,expect} from 'vitest'
import {mkdtempSync,readFileSync,readdirSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createWranglerD1Query,renderWranglerSql} from '../../../../collector/infra/usage/wrangler-d1-query.mjs'
describe('Given a bounded Wrangler OAuth destination with an injected executor',()=>{
 it('When binding strings and 64-bit IDs Then escapes literals without converting string IDs to numbers',()=>{
  expect(renderWranglerSql({sql:"SELECT CAST(? AS INTEGER),?,?,'?'",params:['9007199254740993',"a'; DELETE FROM usage_event; --",null]})).toEqual({ok:true,value:"SELECT CAST('9007199254740993' AS INTEGER),'a''; DELETE FROM usage_event; --',NULL,'?'"})
  expect(renderWranglerSql({sql:'SELECT ?',params:[]})).toMatchObject({ok:false})
  expect(renderWranglerSql({sql:'SELECT ?',params:['x'.repeat(100000)]})).toMatchObject({ok:false})
 })
 it('When querying and writing Then reads with command, writes a private SQL file, serializes and cleans up',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'wrangler-port-')),calls:string[][]=[];let active=0,max=0
  const q=createWranglerD1Query({directory,database:'zzik-usage',wait:async()=>{},execute:async args=>{
   active++;max=Math.max(max,active);calls.push([...args]);await Promise.resolve()
   const file=args.indexOf('--file');if(file>=0){expect(readFileSync(args[file+1],'utf8')).toContain("VALUES('quoted''value')");expect(statSync(args[file+1]).mode&0o777).toBe(0o600)}
   active--;return {exitCode:0,stdout:JSON.stringify([{success:true,results:args.includes('--command')?[{id:'9007199254740993'}]:[]}])}
  }})
  try{const [read,write]=await Promise.all([q.query([{sql:'SELECT CAST(? AS INTEGER)',params:['9007199254740993']}]),q.query([{sql:'INSERT INTO t VALUES(?)',params:["quoted'value"]}])]);expect(read).toMatchObject({ok:true,value:[{results:[{id:'9007199254740993'}]}]});expect(write.ok).toBe(true);expect(max).toBe(1);expect(calls[0]).toContain('--command');expect(calls[1]).toContain('--file');expect(readdirSync(directory)).toEqual([])}finally{rmSync(directory,{recursive:true,force:true})}
 })
 it('When remote file imports prepend progress text despite --json Then parses only the trailing complete JSON result',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'wrangler-prefix-'))
  try{const q=createWranglerD1Query({directory,database:'zzik-usage',execute:async()=>({exitCode:0,stdout:'progress with hidden metadata\n[\n {"success":true,"results":[]}\n]\n'})});expect((await q.query([{sql:'INSERT INTO t VALUES(1)',params:[]}])).ok).toBe(true)}finally{rmSync(directory,{recursive:true,force:true})}
 })
 it('When the process fails or returns malformed/unsuccessful JSON Then returns only a safe failure and does not retry',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'wrangler-errors-'))
  try{for(const response of [{exitCode:1,stdout:'secret-account-token'},{exitCode:0,stdout:'secret-account-token'},{exitCode:0,stdout:'[{"success":false,"error":"secret-account-token"}]'}]){let calls=0;const q=createWranglerD1Query({directory,database:'zzik-usage',execute:async()=>{calls++;return response}});const r=await q.query([{sql:'SELECT 1',params:[]}]);expect(r.ok).toBe(false);expect(JSON.stringify(r)).not.toContain('secret');expect(calls).toBe(1)}}finally{rmSync(directory,{recursive:true,force:true})}
 })
})

describe('Given an invocation outside the repository cwd',()=>{
 it('When executing Wrangler Then resolves the repository installation absolutely',()=>{
  const directory=mkdtempSync(join(tmpdir(),'wrangler-cwd-'))
  try{const url=new URL('../../../../collector/infra/usage/wrangler-d1-query.mjs',import.meta.url).href
   const result=spawnSync(process.execPath,['--input-type=module','-e',`import {executeWrangler} from ${JSON.stringify(url)};const r=await executeWrangler(['--version']);console.log(JSON.stringify({ok:r.exitCode===0}))`],{cwd:directory,encoding:'utf8',timeout:10000})
   expect(result.status).toBe(0);expect(JSON.parse(result.stdout).ok).toBe(true)
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
