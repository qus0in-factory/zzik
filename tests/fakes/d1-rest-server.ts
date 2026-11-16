import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import type {D1Fetch} from '../../collector/domain/usage/d1-sender-types'
/** Local in-memory fake endpoint; executes the checked-in D1 DDL, never opens credentials/network. */
export function fakeD1RestServer(){
 const db=new DatabaseSync(':memory:')
 db.exec(readFileSync(new URL('../../worker/migrations/0001_d1_storage.sql',import.meta.url),'utf8'))
 let loseResponse=false;const bodies:string[]=[]
 const fetch:D1Fetch=async(_url,init)=>{
  bodies.push(init.body)
  const {batch}=JSON.parse(init.body) as {batch:{sql:string;params:(string|number|null)[]}[]}
  const result:Record<string,unknown>[]=[]
  try{
   db.exec('BEGIN')
   for(const q of batch){const s=db.prepare(q.sql);if(/^SELECT/.test(q.sql))result.push({success:true,results:s.all(...q.params)});else result.push({success:true,results:[],meta:{changes:Number(s.run(...q.params).changes)}})}
   db.exec('COMMIT')
  }catch{db.exec('ROLLBACK');return {status:400,headers:{get:()=>null},json:async()=>({success:false})}}
  if(loseResponse){loseResponse=false;throw Error('synthetic response loss after commit')}
  return {status:200,headers:{get:()=>null},json:async()=>({success:true,result})}
 }
 return {db,fetch,bodies,loseNextResponse:()=>{loseResponse=true},close:()=>db.close()}
}
