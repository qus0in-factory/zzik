// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { cardPresentation } from '@app/usage/card-presentation'
import { LimitCard } from '@ui/usage/LimitCard'
import { buildUsageView } from '@domain/usage/view'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import codexUnknownRaw from '../../fixtures/codex-usage.unknown-keys.json'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import limitedRaw from '../../fixtures/claude-usage.limited.json'
import warnRaw from '../../fixtures/claude-usage.warn.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

describe('Given a limit card for the five hour window', () => {
  it('When rendering the normal report card then the value, progress and reset text show up (U1)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    const item = report.windows[0]
    render(<LimitCard item={item} />)
    expect(screen.getByText('5시간 한도')).toBeTruthy()
    expect(screen.getByText('37%')).toBeTruthy()
    expect(screen.getByText('2시간 13분 후 리셋')).toBeTruthy()
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('37')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(screen.getByText('37%').getAttribute('aria-label')).toBe('37퍼센트')
  })
})

describe('Given a limit card status badges', () => {
  it('When rendering an warn level item then the caution badge appears (U3)', () => {
    const report = buildUsageView(warnRaw, { now: NOW })
    const item = report.windows[0]
    render(<LimitCard item={item} presentation={cardPresentation(item, null)} />)
    expect(screen.getByText('주의')).toBeTruthy()
  })

  it('When rendering a normal level item then no threshold badge appears (U3)', () => {
    const report = buildUsageView(warnRaw, { now: NOW })
    const item = report.windows[1]
    render(<LimitCard item={item} presentation={cardPresentation(item, null)} />)
    expect(screen.getByText('62%')).toBeTruthy()
    expect(screen.queryByText('주의')).toBeNull()
    expect(screen.queryByText('한도 도달')).toBeNull()
  })

  it('When rendering 100 and 104 percent items then the limit reached badge appears (U3)', () => {
    const report = buildUsageView(limitedRaw, { now: NOW })
    const windowItem = report.windows[0]
    const sonnet = report.metrics.find((m) => m.id === 'seven_day_sonnet')
    render(
      <>
        <LimitCard item={windowItem} presentation={cardPresentation(windowItem, null)} />
        <LimitCard item={sonnet ?? windowItem} presentation={cardPresentation(sonnet ?? windowItem, null)} />
      </>,
    )
    expect(screen.getAllByText('한도 도달')).toHaveLength(2)
    expect(screen.getByText('104%')).toBeTruthy()
  })

  it('When rendering an expired limit then both the limit badge and the reset passed note appear (U3)', () => {
    const report = buildUsageView(limitedRaw, { now: NOW })
    const cowork = report.metrics.find((m) => m.id === 'seven_day_cowork')
    const coworkItem = cowork ?? report.windows[0]
    render(<LimitCard item={coworkItem} presentation={cardPresentation(coworkItem, null)} />)
    expect(screen.getByText('한도 도달')).toBeTruthy()
    expect(screen.getByText('리셋 지남')).toBeTruthy()
  })
})

describe('Given an item without a usable value', () => {
  it('When rendering a null valued metric then it shows no value and never renders 0% (U2·U3)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    const opus = report.metrics.find((m) => m.id === 'seven_day_opus')
    expect(opus).toBeUndefined()
    render(<LimitCard item={{ ...report.windows[0], usedPercent: null }} />)
    expect(screen.getByText('정보 없음')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

describe('Given card heading levels and unverified labels (ADR 0.3 D8)', () => {
  it('When the card sits inside a provider section then its title is an h4', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<LimitCard item={report.windows[0]} titleLevel={4} />)
    expect(screen.getByRole('heading', { name: '5시간 한도', level: 4 })).toBeTruthy()
  })

  it('When a window label is unverified then the unverified badge appears', () => {
    const report = buildCodexUsageView(codexUnknownRaw, { now: NOW, fetchedAt: NOW_ISO })
    render(<LimitCard item={report.windows[0]} titleLevel={4} />)
    expect(screen.getByText('미확인')).toBeTruthy()
    expect(screen.getByText('3시간 한도')).toBeTruthy()
  })
})

describe('Given Antigravity fractional usage', () => {
  it('When rendering Then formats the display without floating point artifacts or changing the actual progress', () => {
    const percent=(1-0.8)*100
    render(<LimitCard item={{id:'safe',label:'Model group · 5시간 한도',usedPercent:percent,resetsAt:null,expired:false,status:'normal'}} />)
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(String(percent))
  })
})

describe('Given badges and bar share one judgment', () => {
  const item = (used: number, elapsed: number | null) => ({ id: 'x', label: 'X', usedPercent: used, resetsAt: null, expired: false, status: 'normal' as const, elapsedPercent: elapsed })
  it.each([
    [30, 50, null, 'ok'],
    [60, 20, '주의', 'caution'],
    [92, 99, '위험', 'danger'],
    [100, 100, '한도 도달', 'danger'],
    [85, 95, null, 'ok'],
  ] as const)('When used=%s elapsed=%s Then badge %s and bar %s', (used, elapsed, badge, level) => {
    const x = item(used, elapsed)
    render(<LimitCard item={x} presentation={cardPresentation(x, null)} />)
    expect(screen.getByTestId('usage-bar').getAttribute('data-bar-level')).toBe(level)
    for (const text of ['주의', '위험', '한도 도달']) {
      expect(screen.queryByText(text) !== null).toBe(text === badge)
    }
  })
})
