// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PaceChips } from '@ui/usage/PaceChips'
import { makeUsageProviders } from '../../helpers/query'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'

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
