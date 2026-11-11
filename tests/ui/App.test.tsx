// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '@ui/App'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import normalRaw from '../fixtures/claude-usage.normal.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler, createFakeUsageVisibility, NOW } from '../fakes/usage-ports'

afterEach(cleanup)

function renderApp() {
  const gateway = createFakeUsageGateway()
  gateway.pushResult({ ok: true, usage: normalRaw })
  const deps = {
    gateway,
    clock: createFakeUsageClock(),
    scheduler: createFakeUsageScheduler(),
    visibility: createFakeUsageVisibility(),
  }
  const utils = render(
    <UsageGatewayProvider deps={deps}>
      <App />
    </UsageGatewayProvider>,
  )
  return utils
}

describe('Given the dashboard', () => {
  it('When it renders Then Hello Young-In is the main heading', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'Hello Young-In', level: 1 })).toBeTruthy()
  })

  it('When the usage loads Then the usage section appears under the heading (U9)', async () => {
    renderApp()
    expect(screen.getByText('Hello Young-In')).toBeTruthy()
    await screen.findByText('5시간 한도')
    expect(screen.getByText('37%')).toBeTruthy()
  })
})
