// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PaceChips } from '@ui/usage/PaceChips'
import { makeUsageProviders } from '../../helpers/query'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import normalRaw from '../../fixtures/claude-usage.normal.json'

afterEach(cleanup)

describe('Given the pace chip row while data loads', () => {
  it('When providers are still loading Then placeholder chips hold the row height (레이아웃 이동 방지)', () => {
    const gateway = createFakeUsageGateway()
    for (let i = 0; i < 6; i += 1) gateway.pushDeferred()
    const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    render(
      <providers.wrapper>
        <PaceChips />
      </providers.wrapper>,
    )
    const placeholders = screen.getAllByTestId('usage-pace-skeleton')
    expect(placeholders.length).toBe(6)
    for (const item of placeholders) expect(item.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Given a focused chip in the horizontally scrollable row', () => {
  it('When a chip gets keyboard focus Then it scrolls into view with nearest alignment', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
    try {
      const gateway = createFakeUsageGateway()
      gateway.pushResultFor('claude', { ok: true, usage: normalRaw, collection: null, rawText: null })
      const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
      render(
        <providers.wrapper>
          <PaceChips />
        </providers.wrapper>,
      )
      const chip = await screen.findByTestId('usage-pace-claude')

      fireEvent.focus(chip)

      expect(scrollIntoView).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' })
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
    }
  })
})
