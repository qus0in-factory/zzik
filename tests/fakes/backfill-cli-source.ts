import {d1Envelope,D1_NOW} from './d1-contract.ts'
export function backfillCliSource(){return {events:[{id:'1',provider:'claude',status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope())}],snapshots:[]}}
