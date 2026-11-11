// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '@ui/App'
import normalRaw from '../fixtures/claude-usage.normal.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../fakes/usage-ports'
import { makeUsageProviders, createTestQueryClient } from '../helpers/query'

afterEach(cleanup)

function renderApp(client = createTestQueryClient()) {
  const gateway = createFakeUsageGateway()
  gateway.pushResult({ ok: true, usage: normalRaw, collection: null, rawText: null })
  const providers = makeUsageProviders(
    {
      gateway,
      clock: createFakeUsageClock(),
      scheduler: createFakeUsageScheduler(),
    },
    client,
  )
  const utils = render(
    <providers.wrapper>
      <App />
    </providers.wrapper>,
  )
  return { utils, gateway }
}

describe('Given the dashboard', () => {
  it('When it renders Then Hello Young-In is the main heading (U9 계약 유지)', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'Hello Young-In', level: 1 })).toBeTruthy()
  })

  it('When the usage loads through TanStack Query Then the usage section appears under the heading', async () => {
    renderApp()
    expect(screen.getByText('Hello Young-In')).toBeTruthy()
    await screen.findByText('5시간 한도')
    expect(screen.getByText('37%')).toBeTruthy()
  })
})
