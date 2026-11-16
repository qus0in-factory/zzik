import { describe, expect, it } from 'vitest'
import type { UsageHistoryPage } from '../../../../shared/usage-history-contract'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import { elapsedPercent } from '@domain/usage/elapsed'
import { summaryPaceOf } from '@app/usage/summary-pace'
import { buildChartView, chartAlignedData, chartCursorAtTime } from '@app/usage/history/chart-view'
import anchorLive from '../../../fixtures/usage-history/codex.anchor-live.json'
import live from '../../../fixtures/usage-history/codex.xfit-live.json'

const page = live.page as UsageHistoryPage
const now = Date.parse(live.now)
const windows = buildCodexUsageView(live.raw, {now: new Date(now)}).windows
const record: HistoryCacheRecord = {v:1, scanVersion:2, provider:'codex', coveredFrom:page.samples[0].runAt, cursor:page.nextCursor, anchor:null, samples:page.samples, labels:{},seriesOrder:['rate_limit.primary_window'],syncedThroughRunAt:null,syncedAt:live.now}
const input = {provider:'codex' as const, providerTitle:'ChatGPT (Codex)', record, tailEnd:now,range:'7d' as const,hidden:[],shown:[],cardLabels:{},size:{width:800,height:240},nowMs:now,windows}

describe('Given the real Codex weekly-primary collection shape', () => {
  it('When the seven-day chart opens Then it fits real data and its current pace equals the top chip value exactly', () => {
    const view = buildChartView(input)
    const aligned = chartAlignedData(view)!
    expect(aligned.from).toBe(Date.parse(page.samples[0].fetchedAt!)/1000)
    expect(aligned.to).toBe(now/1000)
    expect(view.summary?.pace).toEqual(summaryPaceOf(windows, 'codex'))
    expect(view.pace?.points.at(-1)?.p).toBe(summaryPaceOf(windows, 'codex')!.elapsedPercent)
    expect(aligned.columns.at(-1)?.at(-1)).toBe(summaryPaceOf(windows, 'codex')!.elapsedPercent)
    expect(view.pace?.label).toBe('시간 대비 예상')
    expect(view.table).toHaveLength(1)
  })
  it('When a cursor time falls on a held segment Then its timestamp and value follow that time rather than mismatched array indices', () => {
    const view = buildChartView(input)
    const t = now - 60_000
    const point = chartCursorAtTime(view, t)!
    expect(point.t).toBe(t)
    expect(point.values.find(v=>v.seriesId==='rate_limit.primary_window')?.percent).toBe(86)
    expect(point.values.find(v=>v.seriesId==='__time_pace__')?.percent).toBeLessThan(view.summary!.pace.elapsedPercent)
    expect(chartCursorAtTime(view, now + 1)).toBeNull()
  })
  it('When the source series is hidden Then the summary remains but its pace line is hidden without changing the domain', () => {
    const view = buildChartView({...input,hidden:['rate_limit.primary_window']})
    expect(view.summary).toBeTruthy()
    expect(view.pace).toBeNull()
    expect(chartAlignedData(view)!.from).toBe(chartAlignedData(buildChartView(input))!.from)
  })
})

describe('Given the same summary policy across monthly and weekly windows', () => {
  it('When monthly windows exist Then the highest-use monthly window supplies both summary and pace without a new calculation', () => {
    const weekly = windows[0]
    const allWindows = [weekly, {...weekly, id:'monthly-low', cycleSeconds:30*86400, usedPercent:5, elapsedPercent:25, resetsAt:'2026-12-08T15:26:04.588Z'}, {...weekly, id:'monthly-high',cycleSeconds:30*86400,usedPercent:10,elapsedPercent:50,resetsAt:'2026-12-01T03:26:04.588Z'}]
    const samples = page.samples.map(s=>({...s,values:[...(s.values??[]),{id:'monthly-high',usedPercent:10,cycleSeconds:30*86400,resetsAt:'2026-12-01T03:26:04.588Z'}]}))
    const view = buildChartView({...input,windows:allWindows,record:{...record,samples,seriesOrder:[...record.seriesOrder,'monthly-high']}})
    expect(view.summary?.pace).toEqual(summaryPaceOf(allWindows,'codex'))
    expect(view.summary?.pace.unit).toBe('month')
    expect(view.pace?.points.at(-1)?.p).toBe(view.summary?.pace.elapsedPercent)
    expect(chartAlignedData(view)!.columns.at(-1)!.at(-1)).toBe(view.summary?.pace.elapsedPercent)
  })
})


describe('Given the actual Codex anchor outside the 24h period', () => {
  const anchorPage = anchorLive.page as UsageHistoryPage
  const anchorNow = Date.parse(anchorLive.now)
  const anchorInput = {...input,range:'24h' as const, nowMs:anchorNow,tailEnd:anchorNow, windows:buildCodexUsageView(live.raw,{now:new Date(anchorNow)}).windows, record:{...record,...anchorPage}}
  it('When recent samples are present Then the first real sample defines the domain and no old value is fabricated', () => {
    const view = buildChartView(anchorInput)
    const data = chartAlignedData(view)!
    expect(data.from).toBe(Date.parse(anchorPage.samples[0].fetchedAt!)/1000)
    expect(data.to-data.from).toBeLessThan(90*60)
    expect(data.columns[0][0]).toBe(anchorPage.samples[0].values![0].usedPercent)
  })
  it('When zero samples are in-window Then the old anchor creates neither a series nor a retained tail', () => {
    const view = buildChartView({...anchorInput,record:{...anchorInput.record,samples:[]}})
    const data = chartAlignedData(view)!
    expect(data.to-data.from).toBe(180)
    expect(view.empty).toBe('no_points')
    expect(view.series).toEqual([])
    expect(view.stops).toEqual([])
  })
  it('When the only sample is now Then the span is three minutes and the left padding stays empty', () => {
    const sample = {...anchorPage.samples.at(-1)!,runAt:anchorLive.now,fetchedAt:anchorLive.now}
    const view = buildChartView({...anchorInput,record:{...anchorInput.record,samples:[sample]}})
    const data = chartAlignedData(view)!
    expect(data.to-data.from).toBe(180)
    expect(data.columns[0][0]).toBeNull()
    expect(data.columns[0].at(-1)).toBe(sample.values![0].usedPercent)
  })
})

describe('Given a Grok 24h window where a token_expired sample precedes the first ok sample', () => {
  const grokNow = Date.parse('2026-11-16T04:27:00.000Z')
  const resetsAt = '2026-11-19T07:44:56.981Z'
  const oldAnchor = {
    id: '851',
    runAt: '2026-11-15T02:09:15.577Z',
    status: 'ok' as const,
    fetchedAt: '2026-11-15T02:09:15.577Z',
    intervalSec: 900,
    values: [{ id: 'credits', usedPercent: 67, resetsAt, cycleSeconds: 604800 }],
  }
  const leadingError = {
    id: '941',
    runAt: '2026-11-15T07:39:16.552Z',
    status: 'token_expired' as const,
    fetchedAt: '2026-11-15T07:24:17.410Z',
    intervalSec: 900,
    values: null,
  }
  const firstOk = {
    id: '991',
    runAt: '2026-11-15T10:39:14.814Z',
    status: 'ok' as const,
    fetchedAt: '2026-11-15T10:39:14.814Z',
    intervalSec: 900,
    values: [{ id: 'credits', usedPercent: 67, resetsAt, cycleSeconds: 604800 }],
  }
  const latestOk = {
    id: '1273',
    runAt: '2026-11-16T03:39:15.232Z',
    status: 'ok' as const,
    fetchedAt: '2026-11-16T03:39:15.232Z',
    intervalSec: 900,
    values: [{ id: 'credits', usedPercent: 77, resetsAt, cycleSeconds: 604800 }],
  }
  const grokRecord: HistoryCacheRecord = {
    v: 1,
    scanVersion: 2,
    provider: 'grok',
    coveredFrom: '2026-11-15T04:27:00.000Z',
    cursor: `${latestOk.runAt}_${latestOk.id}`,
    anchor: oldAnchor,
    samples: [leadingError, firstOk, latestOk],
    labels: { credits: '주간 크레딧' },
    seriesOrder: ['credits'],
    syncedThroughRunAt: latestOk.runAt,
    syncedAt: '2026-11-16T04:27:00.000Z',
  }
  const paceWindows = [{
    id: 'credits',
    label: '주간 크레딧',
    usedPercent: 77,
    elapsedPercent: elapsedPercent(resetsAt, 604800, new Date(grokNow)),
    resetsAt,
    cycleSeconds: 604800,
    expired: false,
    status: 'normal' as const,
    resetText: '',
  }]
  const grokInput = {
    provider: 'grok' as const,
    providerTitle: 'Grok',
    record: grokRecord,
    tailEnd: grokNow,
    range: '24h' as const,
    hidden: [],
    shown: [],
    cardLabels: { credits: '주간 크레딧' },
    size: { width: 800, height: 240 },
    nowMs: grokNow,
  }

  it('When a leading error sample precedes the first ok sample Then the domain starts at the first ok sample', () => {
    const view = buildChartView(grokInput)
    const data = chartAlignedData(view)!
    expect(data.from).toBe(Date.parse(firstOk.fetchedAt) / 1000)
    expect(data.to).toBe(grokNow / 1000)
    expect(data.columns[0][0]).toBe(67)
  })

  it('When only error samples exist in the window Then empty no_points and the three-minute minimum span hold', () => {
    const view = buildChartView({ ...grokInput, record: { ...grokRecord, samples: [leadingError] } })
    const data = chartAlignedData(view)!
    expect(data.to - data.from).toBe(180)
    expect(view.empty).toBe('no_points')
    expect(view.series).toEqual([])
    expect(view.stops).toEqual([])
  })

  it('When the 7-day domain starts before the current weekly window start Then pace values before window start are null and after window start match elapsedPercent up to the summary value', () => {
    // grokNow = 2026-11-16T04:27:00Z, resetsAt = 2026-11-19T07:44:56.981Z, cycleSeconds = 604800
    // 현재 주간 창 시작 시각 = 2026-11-12T07:44:56.981Z
    const windowStartMs = Date.parse(resetsAt) - 604800 * 1000
    const beforeWindowSample = {
      id: '700',
      runAt: '2026-11-10T06:00:00.000Z',
      status: 'ok' as const,
      fetchedAt: '2026-11-10T06:00:00.000Z',
      intervalSec: 900,
      values: [{ id: 'credits', usedPercent: 45, resetsAt: '2026-11-12T07:44:56.981Z', cycleSeconds: 604800 }],
    }
    const windows = paceWindows
    const view = buildChartView({
      ...grokInput,
      range: '7d',
      windows,
      record: { ...grokRecord, anchor: null, samples: [beforeWindowSample, firstOk, latestOk] },
    })
    const aligned = chartAlignedData(view)!
    const paceCol = aligned.columns.at(-1)!
    // 창 시작 이전 시점(2026-11-10T06:00:00Z)의 점선 값은 0%가 아니라 null(선 끊김)이다
    const beforeIdx = aligned.times.indexOf(Date.parse(beforeWindowSample.fetchedAt) / 1000)
    expect(beforeIdx).toBe(0)
    expect(paceCol[beforeIdx]).toBeNull()
    expect(chartCursorAtTime(view, Date.parse(beforeWindowSample.fetchedAt))?.values.find((v) => v.seriesId === '__time_pace__')?.percent).toBeNull()

    // 창 시작 시각부터는 0%에서 시작해 elapsedPercent와 일치하고, 현재 시각 값은 요약 경과율과 일치한다
    const startIdx = aligned.times.indexOf(windowStartMs / 1000)
    expect(startIdx).toBeGreaterThan(0)
    expect(paceCol[startIdx]).toBe(0)
    const firstOkIdx = aligned.times.indexOf(Date.parse(firstOk.fetchedAt) / 1000)
    expect(paceCol[firstOkIdx]).toBe(elapsedPercent(resetsAt, 604800, new Date(firstOk.fetchedAt)))
    expect(paceCol.at(-1)).toBe(view.summary?.pace.elapsedPercent)
    expect(view.pace?.points[0]).toEqual({ t: windowStartMs, p: 0 })
    expect(view.pace?.points.at(-1)?.p).toBe(view.summary?.pace.elapsedPercent)
  })

  it('When the domain starts after the current window start Then pace begins at the first domain sample with elapsedPercent', () => {
    const view = buildChartView({
      ...grokInput,
      range: '7d',
      windows: paceWindows,
      record: { ...grokRecord, anchor: null, samples: [firstOk, latestOk] },
    })
    const aligned = chartAlignedData(view)!
    const from = Date.parse(firstOk.fetchedAt)
    const expected = elapsedPercent(resetsAt, 604800, new Date(from))!
    expect(aligned.times[0]).toBe(from / 1000)
    expect(aligned.columns.at(-1)![0]).toBe(expected)
    expect(view.pace?.points[0]).toEqual({ t: from, p: expected })
    expect(view.pace?.points.at(-1)?.p).toBe(view.summary?.pace.elapsedPercent)
  })
})
