import {runBackfillCli} from '../../../scripts/d1-backfill.mjs'
import {backfillCliSource} from '../../fakes/backfill-cli-source.ts'
let writes=0,checkpoint=null
const rows=new Map()
const ports={ledgerOutboxCount:0,source:{read:async()=>({ok:true,value:backfillCliSource()})},checkpoint:{read:()=>({ok:true,value:checkpoint}),write:value=>{checkpoint=value;return {ok:true,value:undefined}}},destination:{
 inspect:async()=>({ok:true,value:{receipts:0,dirtySnapshots:0,dirtyEvents:0,events:rows.size,snapshots:0,maxId:rows.size?'1':null,sequence:rows.size?'1':null}}),
 read:async(_kind,keys)=>({ok:true,value:keys.flatMap(key=>rows.has(key)?[rows.get(key)]:[])}),
 write:async statements=>{writes++;for(const s of statements)if(s.sql.startsWith('INSERT INTO usage_event')){const [id,provider,runAt,status,rawSha256,envelopeJson]=s.params;rows.set(id,{id,provider,status,runAt:new Date(runAt).toISOString(),rawSha256,envelopeJson})}return {ok:true,value:undefined}},
},close:async()=>{}}
try{await runBackfillCli({args:process.argv.slice(2),env:{DB_URL:'synthetic-unused',ZZIK_D1_API_TOKEN:'synthetic-unused',ZZIK_D1_ACCOUNT_ID:'synthetic-unused',ZZIK_D1_DATABASE_ID:'synthetic-unused'},createPorts:async()=>({ok:true,value:ports})})}catch{process.exitCode=1}
process.stdout.write(JSON.stringify({testWrites:writes})+'\n')
