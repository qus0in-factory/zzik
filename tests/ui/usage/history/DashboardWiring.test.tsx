// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render as baseRender, screen } from '@testing-library/react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import type { ChartButtonState } from '@app/usage/history/chart-view'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW_ISO } from '../../../fakes/usage-ports'
import normalRaw from '../../../fixtures/claude-usage.normal.json'

const deps = { gateway: createFakeUsageGateway(), clock: { nowIso: () => NOW_ISO }, scheduler: createFakeUsageScheduler() }
function render(element: ReactElement): void {
  baseRender(<UsageGatewayProvider deps={deps}>{element}</UsageGatewayProvider>)
}
afterEach(cleanup)

const button: ChartButtonState = {
  label: '차트 보기', expanded: false, disabled: false, hint: null, panelId: 'chart-claude',
  onToggle: () => {}, onIntent: () => {},
}

function dashboard(chartPanel: ReactNode): ReactElement {
  return (
    <UsageDashboard
      provider="claude"
      title="Claude"
      status="ready"
      report={buildUsageView(normalRaw)}
      errorMessage={null}
      chart={button}
      chartPanel={chartPanel}
    />
  )
}

describe('Given the chart wiring in the dashboard', () => {
  it('Then the button reaches StatusBar and the panel sits between the notes and the cards', () => {
    render(dashboard(<div data-testid="chart-panel">차트 패널</div>))
    expect(screen.getByRole('button', { name: '차트 보기' }).getAttribute('aria-controls')).toBe('chart-claude')
    const section = screen.getByTestId('usage-section-claude')
    expect(section.innerHTML.indexOf('chart-panel')).toBeGreaterThan(-1)
    expect(section.innerHTML.indexOf('chart-panel')).toBeLessThan(section.innerHTML.indexOf('usage-grid'))
  })

  it('Then a null panel renders no chart region', () => {
    render(dashboard(null))
    expect(screen.queryByTestId('chart-panel')).toBeNull()
  })

  it('Then no chart prop draws no chart button', () => {
    render(<UsageDashboard provider="claude" status="ready" report={buildUsageView(normalRaw)} errorMessage={null} />)
    expect(screen.queryByRole('button', { name: /차트/ })).toBeNull()
  })

  it('Then the composition root injects the T3 view builder from the lazy chunk only', () => {
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main).toContain('buildView: (input) => viewBuilder(input)')
    expect(main).toContain("import('@ui/usage/history/lazy-chart')")
    // 차트 구현·uPlot이 메인 번들에 정적으로 들어가지 않아야 한다
    expect(main).not.toContain("import { buildChartView } from '@app/usage/history/chart-view'")
    expect(main).not.toContain("from 'uplot'")
  })
})
