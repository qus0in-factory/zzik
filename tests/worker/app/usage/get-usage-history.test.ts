import {describe,expect,it} from 'vitest'
import {getUsageHistoryPage,getUsageHistorySummary} from '../../../../worker/app/usage/get-usage-history'
import {FakeHistoryStore} from '../../../fakes/worker-ports'
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
})
