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
import { CHART_OPEN_KEY } from '@app/usage/history/useUsageHistoryPanel'
import { applyForward } from '@domain/usage/history/record'
import { PaceChips } from '@ui/usage/PaceChips'
import { UsageSection } from '@ui/usage/UsageSection'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue, syntheticEvents } from '../../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../../fakes/usage-ports'
import { createTestQueryClient } from '../../../helpers/query'
import type { UsageHistoryPage } from '../../../../shared/usage-history-contract'
import agyRaw from '../../../fixtures/antigravity-usage.gemini-argon.json'
import agySamples from '../../../fixtures/usage-history/antigravity.samples.json'
import live from '../../../fixtures/usage-history/codex.xfit-live.json'

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).CanvasRenderingContext2D
})

function enableFakeCanvas2D() {
  let contexts = 0
  ;(window as unknown as Record<string, unknown>).CanvasRenderingContext2D = class {}
  ;(window as unknown as Record<string, unknown>).Path2D = class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    closePath() {}
  }
  window.matchMedia = (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  HTMLCanvasElement.prototype.getContext = function () {
    contexts += 1
    return {
      save() {},
      restore() {},
      scale() {},
      translate() {},
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      clip() {},
      rect() {},
      fillRect() {},
      strokeRect() {},
      setLineDash() {},
      fillText() {},
      strokeText() {},
      closePath() {},
      measureText: (t: string) => ({ width: String(t).length * 6 }),
    } as unknown as RenderingContext
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
  return { count: () => contexts }
}

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
  it('When a new real-shaped sample arrives Then the existing chart stays mounted during sync and uPlot is recreated once on completion', async () => {
    const canvas = enableFakeCanvas2D()
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
    const region = screen.getByRole('region',{name:'ChatGPT (Codex) 사용률 추이'})
    await waitFor(()=>expect(region.querySelector('.uplot')).toBeTruthy())
    expect(canvas.count()).toBe(1)

    let releaseBgSync!: () => void
    let holdBg = true
    gateway.onBeforeFetch = () => (holdBg ? new Promise<void>((resolve) => { releaseBgSync = () => { holdBg = false; resolve() } }) : Promise.resolve())
    const fetchedAt = new Date(Date.parse(live.now)+15_000).toISOString()
    const next = {...page.samples.at(-1)!,id:'999999',runAt:fetchedAt,fetchedAt,values:page.samples.at(-1)!.values!.map(v=>({...v,usedPercent:87}))}
    server.events.push(next)
    clock.setIso(fetchedAt)
    act(()=>client.setQueryData(usageQueryKey('codex'),{ok:true,usage:{...live.raw,rate_limit:{...live.raw.rate_limit,primary_window:{...live.raw.rate_limit.primary_window,used_percent:87}}},collection:{...collection,runAt:fetchedAt,fetchedAt},rawText:null}))
    // 백그라운드 sync 중에도 스피너로 바뀌지 않고 기존 uPlot 캔버스가 그대로 유지된다
    await waitFor(()=>expect(gateway.queries.length).toBeGreaterThan(1))
    expect(region.querySelector('[data-testid="chart-loading-spinner"]')).toBeNull()
    expect(region.querySelector('.uplot')).toBeTruthy()
    expect(canvas.count()).toBe(1)

    act(()=>releaseBgSync())
    await waitFor(()=>expect(views.at(-1)?.stops.some(s=>s.t===Date.parse(fetchedAt)&&s.values.some(v=>v.percent===87))).toBe(true))
    await waitFor(()=>expect(canvas.count()).toBe(2))
    const view = views.at(-1)!
    expect(view.pace?.points.at(-1)?.t).toBe(Date.parse(fetchedAt))
    expect(view.pace?.points.at(-1)?.p).toBe(view.summary?.pace.elapsedPercent)
    expect(region.querySelector('.chart-toolbar')?.textContent).toContain(screen.getByTestId('usage-pace-codex').textContent)
  })
})

describe('Given a cached chart whose background sync is still running', () => {
  it('When preload already completed and hover/focus repeats Then the existing uPlot and DOM stay unchanged', async () => {
    const canvas = enableFakeCanvas2D()
    const now = Date.parse('2026-11-14T12:00:00.000Z')
    const events = syntheticEvents(60, new Date(now - 18 * 3_600_000).toISOString(), 900_000)
    const server = createFakeHistoryServer('claude', events)
    const first = server.page({ from: new Date(now - 86_400_000).toISOString(), limit: 50, anchor: true })
    const record = applyForward(null, null, first, { provider: 'claude', now: new Date(now).toISOString(), initialFrom: new Date(now - 86_400_000).toISOString() })!
    const gateway = createFakeHistoryGateway({ claude: server })
    gateway.summary = [{ provider: 'claude', okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: events.at(-1)!.runAt }]
    let gated = true
    let releaseSync!: () => void
    gateway.onBeforeFetch = () => gated ? new Promise<void>((resolve) => { releaseSync = () => { gated = false; resolve() } }) : Promise.resolve()
    const usage = createFakeUsageGateway()
    usage.pushResult({ ok: true, usage: { five_hour: { utilization: 40, resets_at: null } }, collection: { schema: 1, provider: 'claude', status: 'ok', called: true, runAt: '2026-11-14T11:45:00.000Z', fetchedAt: '2026-11-14T11:45:00.000Z', httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 900, collectorVersion: 'x', rawOmitted: null }, rawText: null })
    let preloadCalls = 0
    const deps = {
      enabled: true,
      gateway,
      cache: createFakeHistoryCache([record]),
      session: createMemoryKeyValue({ [CHART_OPEN_KEY]: JSON.stringify({ v: 1, open: ['claude'] }) }),
      prefs: createChartPrefsStore(createMemoryKeyValue()),
      budget: createHistoryBudget({ now: () => now }),
      memory: new Map(),
      inflight: new Map(),
      nowMs: () => now,
      preload: () => { preloadCalls += 1; return Promise.resolve() },
      buildView: buildChartView,
    }
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock('2026-11-14T12:00:00.000Z'), scheduler: createFakeUsageScheduler() }}>
          <HistoryDepsProvider deps={deps}><UsageSection provider="claude" /></HistoryDepsProvider>
        </UsageGatewayProvider>
      </QueryClientProvider>,
    )
    const region = await screen.findByRole('region', { name: 'Claude 사용률 추이' })
    await waitFor(() => expect(region.querySelector('.uplot')).toBeTruthy())
    await waitFor(() => expect(gateway.queries.length).toBeGreaterThan(0))
    const plot = region.querySelector('.uplot')
    const initialContexts = canvas.count()
    const close = screen.getByRole('button', { name: '차트 닫기' })

    // preload는 이미 완료됐고 sync는 아직 게이트에 걸려 있다. hover/focus는 뷰를 다시 만들지 않아야 한다.
    fireEvent.pointerEnter(close)
    fireEvent.focus(close)
    fireEvent.pointerEnter(close)
    fireEvent.focus(close)
    expect(preloadCalls).toBe(1)
    expect(canvas.count()).toBe(initialContexts)
    expect(region.querySelector('.uplot')).toBe(plot)

    act(() => releaseSync())
    await waitFor(() => expect(canvas.count()).toBe(initialContexts + 1))
    expect(region.querySelector('.uplot')).toBeTruthy()
  })
})

describe('Given the Antigravity multi-series chart (including Gemini 4 Argon)', () => {
  it('When opened Then a spinner shows during loading, uPlot is created once on completion, and all five usage series stay solid while only pace is dashed', async () => {
    const canvas = enableFakeCanvas2D()
    const page = agySamples as unknown as UsageHistoryPage
    const nowIso = '2026-11-14T00:30:00.000Z'
    const now = Date.parse(nowIso)
    const gateway = createFakeHistoryGateway({ antigravity: createFakeHistoryServer('antigravity', page.samples) })
    gateway.summary = [{ provider: 'antigravity', okCount: 4, firstOkAt: '2026-11-12T23:00:00.000Z', lastOkAt: page.samples.at(-1)!.runAt }]
    let blocked = true
    let releaseFetch!: () => void
    gateway.onBeforeFetch = () => (blocked ? new Promise<void>((resolve) => { releaseFetch = () => { blocked = false; resolve() } }) : Promise.resolve())
    const usage = createFakeUsageGateway()
    usage.pushResultFor('antigravity', { ok: true, usage: agyRaw, collection: null, rawText: null })
    const views: ChartView[] = []
    const deps = {
      enabled: true,
      gateway,
      cache: createFakeHistoryCache(),
      session: createMemoryKeyValue(),
      prefs: createChartPrefsStore(createMemoryKeyValue()),
      budget: createHistoryBudget({ now: () => now }),
      memory: new Map(),
      inflight: new Map(),
      nowMs: () => now,
      buildView: (input: ChartViewInput) => {
        const view = buildChartView(input)
        views.push(view)
        return view
      },
    }
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock(nowIso), scheduler: createFakeUsageScheduler() }}>
          <HistoryDepsProvider deps={deps}>
            <UsageSection provider="antigravity" />
          </HistoryDepsProvider>
        </UsageGatewayProvider>
      </QueryClientProvider>,
    )
    const open = await screen.findByRole('button', { name: '차트 보기' })
    await waitFor(() => expect(open.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(open)
    const region = await screen.findByRole('region', { name: 'Antigravity 사용률 추이' })
    await waitFor(() => expect(region.querySelector('[data-testid="chart-loading-spinner"]')).toBeTruthy())
    expect(region.querySelector('.chart-canvas-host')).toBeNull()
    expect(views).toHaveLength(0)
    expect(canvas.count()).toBe(0)

    act(() => releaseFetch())
    await waitFor(() => expect(region.querySelector('.uplot')).toBeTruthy())
    expect(region.querySelector('[data-testid="chart-loading-spinner"]')).toBeNull()
    expect(views).toHaveLength(1)
    expect(canvas.count()).toBe(1)
    expect(views[0].series.map((s) => [s.id, s.dash])).toEqual([
      ['gemini-5h', null],
      ['gemini-weekly', null],
      ['3p-5h', null],
      ['3p-weekly', null],
      ['argon-weekly', null],
    ])
    const usageSwatches = [...region.querySelectorAll('.chart-swatch-line:not(.chart-pace-swatch)')]
    expect(usageSwatches).toHaveLength(5)
    for (const swatch of usageSwatches) expect(swatch.getAttribute('stroke-dasharray')).toBeNull()
    expect(region.querySelector('.chart-pace-swatch')?.getAttribute('stroke-dasharray')).toBe('6 4')
  })
})
