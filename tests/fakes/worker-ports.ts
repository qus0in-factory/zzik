import type { AccessTokenVerifier, Verification } from '../../worker/domain/access/verifier'
import type { SnapshotStore, StoreResult } from '../../worker/domain/usage/store'
import type { UsageProvider } from '../../shared/usage-contract'

export class FakeVerifier implements AccessTokenVerifier {
  tokens: string[] = []
  constructor(public result: Verification = { ok: true, claims: { email: 'owner@example.com' } }) {}
  async verify(token: string) { this.tokens.push(token); return this.result }
}

/** read(provider)로 제공자별 저장소를 상징한다(ADR 0.3 D7). 읽은 제공자를 기록한다. */
export class FakeStore implements SnapshotStore {
  reads = 0
  providersRead: UsageProvider[] = []
  constructor(public result: StoreResult = { ok: true, value: null }) {}
  async read(provider: UsageProvider): Promise<StoreResult> {
    this.reads++; this.providersRead.push(provider)
    return this.result
  }
}

import type {HistoryStore,HistoryRow,HistoryResult} from '../../worker/domain/usage/history-store'
import type {UsageHistoryQuery,UsageHistorySummaryEntry} from '../../shared/usage-history-contract'
export class FakeHistoryStore implements HistoryStore {
 reads=0
 rows:HistoryRow[]=[]
 anchor:HistoryRow|null=null
 unavailable=false
 async readRows(_provider:UsageProvider,_query:UsageHistoryQuery):Promise<HistoryResult<HistoryRow[]>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:this.rows}}
 async readAnchorRow():Promise<HistoryResult<HistoryRow|null>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:this.anchor}}
 async readSummary(providers:readonly UsageProvider[]):Promise<HistoryResult<UsageHistorySummaryEntry[]>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:providers.map(provider=>({provider,okCount:0,firstOkAt:null,lastOkAt:null}))}}
}
