// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render as baseRender, screen } from '@testing-library/react'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { NOW } from '../../fakes/usage-ports'

const deps = { gateway: createFakeUsageGateway(), clock: { nowIso: () => '2026-11-11T12:00:00.000Z' }, scheduler: createFakeUsageScheduler() }
function render(element: ReactElement) {
  return baseRender(<UsageGatewayProvider deps={deps}>{element}</UsageGatewayProvider>)
}
afterEach(cleanup)

const readyReport = buildUsageView(normalRaw, { now: NOW })

describe('Given a provider usage link', () => {
  it('When rendering claude dashboard Then shows external link with correct attributes', () => {
    render(<UsageDashboard provider="claude" title="Claude" status="ready" report={readyReport} errorMessage={null} />)
    const link = screen.getByTestId('provider-usage-link')
    expect(link.getAttribute('href')).toBe('https://claude.ai/new#settings/usage')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('aria-label')).toBe('Claude 사용량 페이지 열기')
    expect(link.getAttribute('title')).toBe('Claude 사용량 페이지 열기')
  })

  it('When rendering antigravity dashboard Then no usage link', () => {
    render(<UsageDashboard provider="antigravity" title="Antigravity" status="ready" report={readyReport} errorMessage={null} />)
    expect(screen.queryByTestId('provider-usage-link')).toBeNull()
  })

  it('When loading claude Then link still renders (fixed slot)', () => {
    render(<UsageDashboard provider="claude" title="Claude" status="loading" report={null} errorMessage={null} />)
    expect(screen.getByTestId('provider-usage-link')).toBeTruthy()
  })
})
