import type { AccessTokenVerifier, Verification } from '../../worker/domain/access/verifier'
import type { SnapshotStore, StoreResult } from '../../worker/domain/usage/store'
import type { BucketStore } from '../../worker/domain/usage/bucket-store'
import type { UsageProvider } from '../../shared/usage-contract'
import type { UsageHistoryBucketsPage, UsageHistoryBucketsQuery, UsageHistorySample } from '../../shared/usage-history-contract'
import { USAGE_HISTORY_SCAN_VERSION } from '../../shared/usage-history-contract'

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
 before:HistoryRow|null=null
 unavailable=false
 async readRows(_provider:UsageProvider,_query:UsageHistoryQuery):Promise<HistoryResult<HistoryRow[]>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:this.rows}}
 async readAnchorRow():Promise<HistoryResult<HistoryRow|null>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:this.anchor}}
 async readRowBefore():Promise<HistoryResult<HistoryRow|null>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:this.before}}
 async readSummary(providers:readonly UsageProvider[]):Promise<HistoryResult<UsageHistorySummaryEntry[]>>{this.reads++;return this.unavailable?{ok:false,reason:'storage_unavailable'}:{ok:true,value:providers.map(provider=>({provider,okCount:0,firstOkAt:null,lastOkAt:null}))}}
}


/** Bucket route fake: records validated queries and returns a configured page. */
export class FakeBucketStore implements BucketStore {
  reads = 0
  queries: UsageHistoryBucketsQuery[] = []
  unavailable = false
  samples: UsageHistorySample[] = []
  anchor: UsageHistorySample | null = null
  complete = true
  async readBuckets(provider: UsageProvider, query: UsageHistoryBucketsQuery) {
    this.reads += 1
    this.queries.push(query)
    if (this.unavailable) return { ok: false as const, reason: 'storage_unavailable' as const }
    const value: UsageHistoryBucketsPage = {
      provider,
      scanVersion: USAGE_HISTORY_SCAN_VERSION,
      bucketSec: query.bucketSec,
      from: query.from,
      until: query.until,
      samples: this.samples,
      anchor: this.anchor,
      complete: this.complete,
    }
    return { ok: true as const, value }
  }
}
