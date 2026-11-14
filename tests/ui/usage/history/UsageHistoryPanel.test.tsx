// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChartPanelActions, ChartPanelState, ChartView, UsageHistoryPanelProps } from '@app/usage/history/chart-view'
import { UsageHistoryPanel } from '@ui/usage/history/UsageHistoryPanel'

afterEach(cleanup)

const SERIES: ChartView['series'] = [
  { id: 'a', label: '5시간 한도', slot: 1, dash: null, hidden: false, paths: [], dots: [], endLabel: null },
  { id: 'b', label: '주간 한도', slot: 2, dash: null, hidden: false, paths: [], dots: [], endLabel: null },
  { id: 'c', label: '추가 사용량', slot: 3, dash: null, hidden: false, paths: [], dots: [], endLabel: null },
  { id: 'd', label: '네 번째', slot: 4, dash: '6 3', hidden: false, paths: [], dots: [], endLabel: null },
]

function makeView(overrides: Partial<ChartView> = {}): ChartView {
  const series = SERIES.map((s) => ({ ...s }))
  const stops = [0, 1, 2].map((i) => ({
    t: i * 1000,
    x: 34 + i * 100,
    label: `11월 ${7 + i}일 10:15`,
    values: series.map((s, j) => ({ seriesId: s.id, percent: 40 - j * 10, text: `${40 - j * 10}%`, y: 100 + j * 10 })),
    valueText: `11월 ${7 + i}일 10:15 — 5시간 한도 ${40 - i}%, 주간 한도 30%`,
  }))
  return {
    range: '7d',
    width: 640,
    height: 240,
    plot: { x: 34, y: 10, width: 560, height: 206 },
    title: 'Claude 사용률 추이 · 최근 7일',
    description: '11월 7일 10:15부터 11월 14일 10:15까지. 계열 4개 중 4개 표시.',
    xTicks: [{ x: 34, label: '11월 7일' }, { x: 594, label: '11월 14일' }],
    yTicks: [{ y: 10, label: '100%' }, { y: 216, label: '0%' }],
    series,
    stops,
    table: series.map((s) => ({ id: s.id, label: s.label, current: '42%', peak: '96% (11월 8일 10:15)', low: '3%', resets: 1 })),
    empty: 'none',
    ...overrides,
  }
}

function setup(overrides: Partial<UsageHistoryPanelProps> = {}): { calls: string[]; actions: ChartPanelActions; container: HTMLElement } {
  const calls: string[] = []
  const actions: ChartPanelActions = {
    onSelectRange: (range) => calls.push(`range:${range}`),
    onToggleSeries: (id) => calls.push(`toggle:${id}`),
    onShowAllSeries: () => calls.push('showAll'),
    onRetry: () => calls.push('retry'),
    onResize: () => calls.push('resize'),
  }
  const state: ChartPanelState = { phase: 'ready', view: makeView(), syncing: false, progress: null, note: null }
  const props: UsageHistoryPanelProps = {
    panelId: 'chart-claude',
    regionLabel: 'Claude 사용률 추이',
    range: '7d',
    ...overrides,
    state: overrides.state ?? state,
    actions: overrides.actions ?? actions,
  }
  render(<UsageHistoryPanel {...props} />)
  return { calls, actions, container: document.body }
}

describe('Given the uPlot history chart panel', () => {
  it('Then a canvas host is rendered with the title/description and an accessibility data table', () => {
    const { container } = setup()
    expect(container.querySelector('.chart-canvas-host')).toBeTruthy()
    const a11y = container.querySelector('.chart-a11y')
    expect(a11y?.textContent).toContain('Claude 사용률 추이 · 최근 7일')
    expect(a11y?.textContent).toContain('계열 4개 중 4개 표시')
    const table = container.querySelector('.chart-a11y-table')
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(3)
    expect(table?.querySelector('thead')?.textContent).toContain('5시간 한도')
  })

  it('Then slot 1~3 swatches are solid and slot 4 carries its 6 3 dash', () => {
    const { container } = setup()
    const lines = [...container.querySelectorAll('.chart-swatch-line')]
    expect(lines.find((line) => line.getAttribute('data-slot') === '4')?.getAttribute('stroke-dasharray')).toBe('6 3')
    for (const slot of ['1', '2', '3']) {
      for (const line of lines.filter((item) => item.getAttribute('data-slot') === slot)) expect(line.getAttribute('stroke-dasharray')).toBeNull()
    }
  })

  it('Then the range input is focusable (clipped), max = stops.length − 1 and aria-valuetext from the view', () => {
    setup()
    const input = screen.getByRole('slider') as HTMLInputElement
    expect(input.getAttribute('min')).toBe('0')
    expect(input.getAttribute('max')).toBe('2')
    expect(input.getAttribute('step')).toBe('1')
    expect(input.getAttribute('aria-valuetext')).toBe(makeView().stops[2].valueText)
    expect(input.hasAttribute('disabled')).toBe(false)
    expect(input.style.display).not.toBe('none')
  })

  it('Then legend buttons expose aria-pressed and clicking toggles a series through actions', () => {
    const { calls } = setup()
    const buttons = screen.getAllByRole('button', { name: /한도|사용량|번째/ })
    expect(buttons).toHaveLength(4)
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(buttons[0])
    expect(calls).toContain('toggle:a')
  })

  it('Then range tabs call onSelectRange', () => {
    const { calls } = setup()
    fireEvent.click(screen.getByRole('button', { name: '24시간' }))
    expect(calls).toContain('range:24h')
    fireEvent.click(screen.getByRole('button', { name: '30일' }))
    expect(calls).toContain('range:30d')
  })

  it('Then a hidden series has aria-pressed=false, leaves the a11y table, and 모두 표시 works', () => {
    const view = makeView()
    view.series[0] = { ...view.series[0], hidden: true }
    const { calls, container } = setup({ state: { phase: 'ready', view, syncing: false, progress: null, note: null } })
    expect(screen.getAllByRole('button', { name: /한도|사용량|번째/ })[0].getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('.chart-a11y-table')?.textContent).not.toContain('5시간 한도')
    fireEvent.click(screen.getByRole('button', { name: '모두 표시' }))
    expect(calls).toContain('showAll')
  })

  it('Then the visible summary table includes hidden series too', () => {
    const view = makeView()
    view.series[1] = { ...view.series[1], hidden: true }
    setup({ state: { phase: 'ready', view, syncing: false, progress: null, note: null } })
    expect(screen.getByText('표로 보기')).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: '주간 한도' })).toBeTruthy()
  })

  it('Then the two empty states show their own message', () => {
    setup({ state: { phase: 'ready', view: makeView({ empty: 'no_points' }), syncing: false, progress: null, note: null } })
    expect(screen.getByText('표시할 이력이 없습니다')).toBeTruthy()
    cleanup()
    const hiddenView = makeView({ empty: 'all_hidden', series: SERIES.map((s) => ({ ...s, hidden: true })) })
    const calls: string[] = []
    render(<UsageHistoryPanel panelId="chart-claude" regionLabel="Claude 사용률 추이" range="7d" state={{ phase: 'ready', view: hiddenView, syncing: false, progress: null, note: null }} actions={{ onSelectRange: () => {}, onToggleSeries: () => {}, onShowAllSeries: () => calls.push('showAll'), onRetry: () => {}, onResize: () => {} }} />)
    expect(screen.getByText(/모든 계열이 숨겨져 있습니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '모두 표시' }))
    expect(calls).toContain('showAll')
  })

  it('Then loading shows a skeleton and error shows the message plus a retry action', () => {
    setup({ state: { phase: 'loading' } })
    expect(document.querySelector('[data-slot="skeleton"]')).toBeTruthy()
    cleanup()
    const calls: string[] = []
    render(<UsageHistoryPanel panelId="chart-claude" regionLabel="Claude 사용률 추이" range="7d" state={{ phase: 'error', message: '이력을 불러오지 못했습니다' }} actions={{ onSelectRange: () => {}, onToggleSeries: () => {}, onShowAllSeries: () => {}, onRetry: () => calls.push('retry'), onResize: () => {} }} />)
    expect(screen.getByRole('alert').textContent).toContain('이력을 불러오지 못했습니다')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(calls).toContain('retry')
  })
})
