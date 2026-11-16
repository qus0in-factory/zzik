// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { usageQueryKey } from '@app/usage/usage-query'
import type { ChartView } from '@app/usage/history/chart-view'
import type { ChartViewInput } from '@app/usage/history/chart-view-input'
import { buildChartView } from '@app/usage/history/chart-view'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { PaceChips } from '@ui/usage/PaceChips'
import { UsageSection } from '@ui/usage/UsageSection'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue } from '../../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../../fakes/usage-ports'
import { createTestQueryClient } from '../../../helpers/query'
import type { UsageHistoryPage } from '../../../../shared/usage-history-contract'
import live from '../../../fixtures/usage-history/codex.xfit-live.json'

afterEach(cleanup)

describe('Given the top pace chips and the provider chart sharing real Codex-shaped data', () => {
  it('When the chart opens through its real hook Then the same summary appears beside the chart tabs and the dashed pace legend appears', async () => {
    const page = live.page as UsageHistoryPage
    const now = Date.parse(live.now)
    const gateway = createFakeHistoryGateway({codex:createFakeHistoryServer('codex', page.samples)})
    gateway.summary = [{provider:'codex',okCount:1,firstOkAt:page.samples[0].runAt,lastOkAt:page.samples.at(-1)!.runAt}]
    const usage = createFakeUsageGateway()
    usage.pushResultFor('codex',{ok:true,usage:live.raw,collection:null,rawText:null})
    const prefs = createChartPrefsStore(createMemoryKeyValue())
    const deps = {enabled:true,gateway,cache:createFakeHistoryCache(),session:createMemoryKeyValue(),prefs,budget:createHistoryBudget({now:()=>now}),memory:new Map(),inflight:new Map(),nowMs:()=>now,buildView:buildChartView}
    render(<QueryClientProvider client={createTestQueryClient()}>
      <UsageGatewayProvider deps={{gateway:usage,clock:createFakeUsageClock(live.now),scheduler:createFakeUsageScheduler()}}>
        <HistoryDepsProvider deps={deps}><PaceChips /><UsageSection provider="codex" /></HistoryDepsProvider>
      </UsageGatewayProvider>
    </QueryClientProvider>)
    const chip = await screen.findByTestId('usage-pace-codex')
    const open = await screen.findByRole('button',{name:'차트 보기'})
    await waitFor(()=>expect(open.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(open)
    const region = await screen.findByRole('region',{name:'ChatGPT (Codex) 사용률 추이'})
    await waitFor(()=>expect(region.querySelector('.chart-toolbar')?.textContent).toContain(chip.textContent))
    expect(within(region.querySelector('.chart-legend') as HTMLElement).getByText('시간 대비 예상')).toBeTruthy()
    expect(region.querySelector('.chart-pace-swatch')?.getAttribute('stroke-dasharray')).toBe('6 4')
  })
})


describe('Given an open chart receiving a snapshot between shared clock ticks', () => {
  it('When a new real-shaped sample arrives Then its time and value appear without waiting for the next 30s tick', async () => {
    const page = live.page as UsageHistoryPage
    const clock = createFakeUsageClock(live.now)
    const scheduler = createFakeUsageScheduler()
    const server = createFakeHistoryServer('codex',page.samples)
    const gateway = createFakeHistoryGateway({codex:server})
    gateway.summary = [{provider:'codex',okCount:1,firstOkAt:page.samples[0].runAt,lastOkAt:page.samples.at(-1)!.runAt}]
    const collection = {schema:1 as const,provider:'codex' as const,status:'ok' as const,called:true,runAt:page.samples.at(-1)!.runAt,fetchedAt:page.samples.at(-1)!.fetchedAt,httpStatus:200,retryAt:null,tokenExpiresAt:null,kvTokenExpiresAt:null,intervalSec:900,collectorVersion:'0.6.0',rawOmitted:null}
    const usage = createFakeUsageGateway()
    usage.pushResultFor('codex',{ok:true,usage:live.raw,collection,rawText:null})
    const client = createTestQueryClient()
    const views: ChartView[] = []
    const deps = {enabled:true,gateway,cache:createFakeHistoryCache(),session:createMemoryKeyValue(),prefs:createChartPrefsStore(createMemoryKeyValue()),budget:createHistoryBudget({now:()=>Date.parse(clock.nowIso())}),memory:new Map(),inflight:new Map(),nowMs:()=>Date.parse(clock.nowIso()),buildView:(input:ChartViewInput)=>{const view=buildChartView(input);views.push(view);return view}}
    render(<QueryClientProvider client={client}><UsageGatewayProvider deps={{gateway:usage,clock,scheduler}}><HistoryDepsProvider deps={deps}><PaceChips /><UsageSection provider="codex" /></HistoryDepsProvider></UsageGatewayProvider></QueryClientProvider>)
    const open = await screen.findByRole('button',{name:'차트 보기'})
    await waitFor(()=>expect(open.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(open)
    await waitFor(()=>expect(views.at(-1)?.table[0]?.current).toBe('86%'))
    const fetchedAt = new Date(Date.parse(live.now)+15_000).toISOString()
    const next = {...page.samples.at(-1)!,id:'999999',runAt:fetchedAt,fetchedAt,values:page.samples.at(-1)!.values!.map(v=>({...v,usedPercent:87}))}
    server.events.push(next)
    clock.setIso(fetchedAt)
    act(()=>client.setQueryData(usageQueryKey('codex'),{ok:true,usage:{...live.raw,rate_limit:{...live.raw.rate_limit,primary_window:{...live.raw.rate_limit.primary_window,used_percent:87}}},collection:{...collection,runAt:fetchedAt,fetchedAt},rawText:null}))
    await waitFor(()=>expect(views.at(-1)?.stops.some(s=>s.t===Date.parse(fetchedAt)&&s.values.some(v=>v.percent===87))).toBe(true))
    const view = views.at(-1)!
    expect(view.pace?.points.at(-1)?.t).toBe(Date.parse(fetchedAt))
    expect(view.pace?.points.at(-1)?.p).toBe(view.summary?.pace.elapsedPercent)
    const region = screen.getByRole('region',{name:'ChatGPT (Codex) 사용률 추이'})
    expect(region.querySelector('.chart-toolbar')?.textContent).toContain(screen.getByTestId('usage-pace-codex').textContent)
  })
})
