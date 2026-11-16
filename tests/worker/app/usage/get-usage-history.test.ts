import {describe,expect,it} from 'vitest'
import {getUsageHistoryBuckets,getUsageHistoryPage,getUsageHistorySummary} from '../../../../worker/app/usage/get-usage-history'
import {FakeBucketStore,FakeHistoryStore} from '../../../fakes/worker-ports'
import {USAGE_HISTORY_SCAN_VERSION} from '../../../../shared/usage-history-contract'
import type {HistoryResult,HistoryRow} from '../../../../worker/domain/usage/history-store'
describe('Given history use cases',()=>{
 it('When the optional anchor lookup fails Then no partial page or cursor escapes',async()=>{
  class FailingAnchor extends FakeHistoryStore {override async readAnchorRow():Promise<HistoryResult<HistoryRow|null>>{this.reads++;return {ok:false,reason:'storage_unavailable'}}}
  const store=new FailingAnchor()
  expect(await getUsageHistoryPage(store,'claude',{limit:50,from:'2026-11-11T00:00:00.000Z',anchor:true})).toEqual({ok:false,reason:'storage_unavailable'});expect(store.reads).toBe(2)
 })
 it('When anchor is not requested Then it is never read and a complete empty page is versioned',async()=>{
  const store=new FakeHistoryStore();expect(await getUsageHistoryPage(store,'claude',{limit:50})).toEqual({ok:true,value:{provider:'claude',scanVersion:USAGE_HISTORY_SCAN_VERSION,samples:[],anchor:null,nextCursor:null,hasMore:false}});expect(store.reads).toBe(1)
 })
 it('When the summary store fails Then storage_unavailable is preserved',async()=>{
  const store=new FakeHistoryStore();store.unavailable=true;expect(await getUsageHistorySummary(store)).toEqual({ok:false,reason:'storage_unavailable'})
 })
 it('When the bucket store returns a page Then the use case passes it through without touching raw history',async()=>{
  const store=new FakeBucketStore()
  const result=await getUsageHistoryBuckets(store,'claude',{from:'2026-11-01T00:00:00.000Z',until:'2026-11-16T00:00:00.000Z',bucketSec:900})
  expect(result).toMatchObject({ok:true,value:{provider:'claude',bucketSec:900,complete:true}});expect(store.reads).toBe(1)
 })
 it('When the bucket store fails Then storage_unavailable is preserved',async()=>{
  const store=new FakeBucketStore();store.unavailable=true
  expect(await getUsageHistoryBuckets(store,'claude',{from:'2026-11-01T00:00:00.000Z',until:'2026-11-16T00:00:00.000Z',bucketSec:900})).toEqual({ok:false,reason:'storage_unavailable'})
 })
})
