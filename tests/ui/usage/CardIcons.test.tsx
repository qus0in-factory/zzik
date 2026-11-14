// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { buildOpencodeUsageView } from '@domain/usage/opencode-view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import opencodeRaw from '../../fixtures/opencode-usage.normal.json'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

const deps = { gateway: createFakeUsageGateway(), clock: { nowIso: () => NOW_ISO }, scheduler: createFakeUsageScheduler() }
const renderDashboard = (element: React.ReactElement) => render(<UsageGatewayProvider deps={deps}>{element}</UsageGatewayProvider>)
const kindOf = (cardId: string) => {
  const card = screen.getAllByTestId('usage-card').find((element) => element.getAttribute('data-card-id') === cardId) as HTMLElement
  return card.querySelector('[data-testid="card-kind-icon"]')?.getAttribute('data-kind')
}

describe('Given the card kind pictograms (종류별 아이콘)', () => {
  it('When a Claude report renders Then 5h is short, weekly is weekly, per-model metrics are model, extra usage is extra', () => {
    renderDashboard(<UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView(normalRaw, { now: NOW })} />)
    expect(kindOf('five_hour')).toBe('short')
    expect(kindOf('seven_day')).toBe('weekly')
    expect(kindOf('seven_day_sonnet')).toBe('model')
    expect(kindOf('extra_usage')).toBe('extra')
  })
  it('When an OpenCode report renders Then rolling is short, weekly weekly, monthly monthly (cycle from resetsAt)', () => {
    renderDashboard(<UsageDashboard provider="opencode" status="ready" errorMessage={null} report={buildOpencodeUsageView(opencodeRaw, { now: NOW })} />)
    expect(kindOf('rolling')).toBe('short')
    expect(kindOf('weekly')).toBe('weekly')
    expect(kindOf('monthly')).toBe('monthly')
  })
  it('Then every pictogram is decorative, 16px and muted', () => {
    renderDashboard(<UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView(normalRaw, { now: NOW })} />)
    for (const icon of screen.getAllByTestId('card-kind-icon')) {
      expect(icon.getAttribute('aria-hidden')).toBe('true')
      expect(icon.getAttribute('class')).toContain('size-4')
      expect(icon.getAttribute('class')).toContain('text-muted-foreground')
    }
  })
})

describe('Given the raw property name info button', () => {
  const open = () => renderDashboard(<UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView(normalRaw, { now: NOW })} />)
  it('Then the raw id is not shown on the card, the button is labeled by card and described by an sr-only id', () => {
    open()
    const card = screen.getAllByTestId('usage-card')[0]
    expect(card.querySelector('code')).toBeNull()
    const button = within(card).getByTestId('usage-card-info')
    expect(button.getAttribute('aria-label')).toBe('5시간 한도 원본 속성 이름 보기')
    expect(button.querySelector('svg')?.getAttribute('class')).toContain('size-3.5')
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('five_hour')
  })
  it('When the button is tapped Then the tooltip opens with the id; a second tap or Escape closes it', async () => {
    open()
    const button = screen.getAllByTestId('usage-card-info')[0]
    fireEvent.click(button)
    expect((await screen.findAllByTestId('usage-card-info-content'))[0].textContent).toBe('five_hour')
    fireEvent.click(button)
    await waitFor(() => expect(screen.queryByTestId('usage-card-info-content')).toBeNull())
    fireEvent.click(button)
    await screen.findAllByTestId('usage-card-info-content')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('usage-card-info-content')).toBeNull())
  })
  it('When the button receives keyboard focus Then the tooltip opens', async () => {
    open()
    screen.getAllByTestId('usage-card-info')[0].focus()
    expect((await screen.findAllByTestId('usage-card-info-content'))[0].textContent).toBe('five_hour')
  })
})

describe('Given the section pictograms', () => {
  it('Then the first group has no subtitle, the metrics subtitle has an icon, and the status row has history and refresh icons', () => {
    renderDashboard(
      <UsageDashboard provider="claude" title="Claude" status="ready" errorMessage={null} report={buildUsageView(normalRaw, { now: NOW })} lastSuccessText="마지막 수집 10:09 (7분 전)" onRetry={() => {}} />,
    )
    expect(screen.queryByRole('heading', { name: '사용 창' })).toBeNull()
    const subtitle = screen.getByRole('heading', { name: '모델·기능별 한도', level: 3 })
    expect(subtitle.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    const refresh = screen.getByRole('button', { name: /새로고침/ })
    expect(refresh.querySelector('svg')?.getAttribute('class')).toContain('size-4')
    expect(refresh.querySelector('[data-testid="refresh-spinner"]')).toBeNull()
    expect(screen.getByText('마지막 수집 10:09 (7분 전)').querySelector('svg[aria-hidden="true"]')).toBeTruthy()
  })
  it('When refreshing Then the spinner replaces the refresh icon', () => {
    renderDashboard(<UsageDashboard provider="claude" title="Claude" status="ready" errorMessage={null} report={buildUsageView(normalRaw, { now: NOW })} refreshing onRetry={() => {}} />)
    const refresh = screen.getByRole('button', { name: /새로고침/ })
    expect(refresh.querySelectorAll('svg')).toHaveLength(1)
    expect(within(refresh).getByTestId('refresh-spinner')).toBeTruthy()
  })
})
