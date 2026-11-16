// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
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
