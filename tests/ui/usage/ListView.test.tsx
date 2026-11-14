// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { ViewModeProvider } from '@app/usage/ViewModeContext'
import { createViewModeStore } from '@app/usage/view-mode-store'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { ViewModeToggle } from '@ui/usage/ViewModeToggle'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

const deps = { gateway: createFakeUsageGateway(), clock: { nowIso: () => NOW_ISO }, scheduler: createFakeUsageScheduler() }
const report = buildUsageView(normalRaw, { now: NOW })
function renderIn(mode: 'grid' | 'list', element: ReactElement) {
  const store = createViewModeStore({ load: () => mode, save: () => {} })
  return { store, ...render(<UsageGatewayProvider deps={deps}><ViewModeProvider store={store}>{element}</ViewModeProvider></UsageGatewayProvider>) }
}
const dashboard = <UsageDashboard provider="claude" title="Claude" status="ready" errorMessage={null} report={report} />

describe('Given the list view (표 행)', () => {
  it('When mode is list Then each group is a real table with sr-only caption, column headers (scope col) and row headers (scope row)', () => {
    renderIn('list', dashboard)
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(2) // 사용 한도 + 모델·기능별 한도
    expect(tables[0].querySelector('caption')?.className).toContain('sr-only')
    expect(tables[0].querySelector('caption')?.textContent).toBe('Claude 사용 한도 목록')
    expect(tables[1].querySelector('caption')?.textContent).toBe('Claude 모델·기능별 한도')
    expect([...tables[0].querySelectorAll('thead th')].map((th) => [th.textContent, th.getAttribute('scope')])).toEqual([['한도', 'col'], ['사용률', 'col'], ['진행', 'col'], ['기간 경과', 'col'], ['리셋', 'col']])
    const rows = within(tables[0]).getAllByTestId('usage-row')
    expect(rows).toHaveLength(report.windows.length)
    for (const row of rows) expect(row.querySelector('th')?.getAttribute('scope')).toBe('row')
    expect(screen.queryByTestId('usage-card')).toBeNull()
  })
  it('Then the metrics group keeps its subtitle above its table', () => {
    renderIn('list', dashboard)
    const subtitle = screen.getByRole('heading', { name: '모델·기능별 한도', level: 3 })
    expect(subtitle.nextElementSibling?.querySelector('table')).toBeTruthy()
  })
  it('Then a row carries icon, label with info button, percent, a small bar with the elapsed marker, elapsed % and reset text', () => {
    renderIn('list', dashboard)
    const row = screen.getAllByTestId('usage-row').find((element) => element.getAttribute('data-row-id') === 'five_hour') as HTMLElement
    expect(row.querySelector('[data-testid="card-kind-icon"]')?.getAttribute('data-kind')).toBe('short')
    expect(within(row).getByTestId('usage-row-label').textContent).toBe('5시간 한도')
    expect(within(row).getByTestId('usage-card-info').getAttribute('aria-label')).toBe('5시간 한도 원본 속성 이름 보기')
    expect(within(row).getByLabelText('37퍼센트').textContent).toBe('37%')
    expect(row.querySelector('[data-slot="progress"]')?.getAttribute('aria-label')).toContain('5시간 한도 사용률')
    expect(row.querySelector('[data-testid="usage-bar"] .border-foreground')).toBeTruthy()
    const cells = row.querySelectorAll('td')
    expect(cells[2].textContent).toBe('56%')
    expect(cells[3].textContent).toContain('리셋')
  })
  it('Then the gerbil is left out of the list (clean rows) and narrow screens get a second line under the name', () => {
    renderIn('list', dashboard)
    expect(screen.queryByTestId('activity-gerbil')).toBeNull()
    const row = screen.getAllByTestId('usage-row')[0]
    expect(row.querySelector('th p.sm\\:hidden')?.textContent).toContain('기간 경과')
    expect(row.querySelectorAll('td.hidden').length).toBe(2) // 모바일에서 숨겨지는 열 두 개
    expect(row.className).toContain('h-14')
  })
  it('When a window has a warning level Then the badge is in the percent cell (desktop) and the bar level attribute is set', () => {
    const warm = buildUsageView({ five_hour: { utilization: 95, resets_at: '2026-11-11T14:00:00Z' } }, { now: NOW })
    renderIn('list', <UsageDashboard provider="claude" title="Claude" status="ready" errorMessage={null} report={warm} />)
    const row = screen.getByTestId('usage-row')
    expect(within(row).getByText('위험')).toBeTruthy()
    expect(row.querySelector('[data-testid="usage-bar"]')?.getAttribute('data-bar-level')).toBe('danger')
  })
  it('When loading Then the skeleton is list-shaped with rows of the same fixed height', () => {
    renderIn('list', <UsageDashboard provider="claude" title="Claude" status="loading" report={null} errorMessage={null} />)
    expect(screen.queryByTestId('usage-skeleton-grid')).toBeNull()
    const rows = screen.getAllByTestId('usage-skeleton-row')
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.className).toContain('h-14')
  })
  it('When mode is grid Then cards and the grid skeleton are used (기본)', () => {
    renderIn('grid', dashboard)
    expect(screen.getAllByTestId('usage-card').length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).toBeNull()
    cleanup()
    renderIn('grid', <UsageDashboard provider="claude" title="Claude" status="loading" report={null} errorMessage={null} />)
    expect(screen.getByTestId('usage-skeleton-grid')).toBeTruthy()
  })
  it('When the mode switches Then the content is remounted (short fade-in replays) and rows/cards swap', () => {
    const { store } = renderIn('grid', dashboard)
    const card = screen.getAllByTestId('usage-card')[0]
    expect(card.className).toContain('fade-in')
    fireEvent.click(document.body) // no-op
    store.getState().setMode('list')
    return Promise.resolve().then(() => {
      expect(screen.queryByTestId('usage-card')).toBeNull()
    })
  })
})

describe('Given the view mode toggle', () => {
  it('Then two icon buttons in a labeled group expose aria-pressed and switch the global mode', () => {
    const store = createViewModeStore(null)
    render(<ViewModeProvider store={store}><ViewModeToggle /></ViewModeProvider>)
    expect(screen.getByRole('group', { name: '보기 방식' })).toBeTruthy()
    const grid = screen.getByRole('button', { name: '카드 보기' })
    const list = screen.getByRole('button', { name: '목록 보기' })
    expect(grid.getAttribute('aria-pressed')).toBe('true')
    expect(list.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(list)
    expect(store.getState().mode).toBe('list')
    expect(screen.getByRole('button', { name: '목록 보기' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '카드 보기' }).getAttribute('aria-pressed')).toBe('false')
  })
})
