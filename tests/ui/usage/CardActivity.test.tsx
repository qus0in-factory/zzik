// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW_ISO } from '../../fakes/usage-ports'
afterEach(cleanup)
describe('Given a mounted usage card', () => {
  it('When values change Then runs at the new speed and stops at expiry', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number) => <UsageGatewayProvider deps={deps}><UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization: value } })} /></UsageGatewayProvider>
    const mounted = render(view(10))
    expect(screen.queryByText('🐈')).toBeNull()
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(12))
    expect(screen.getByText('🐈').parentElement?.style.animationDuration).toBe('4s')
    mounted.rerender(view(22))
    expect(screen.getByText('🐈').parentElement?.style.animationDuration).toBe('0.8s')
    act(() => scheduler.runScheduledAt(300_000))
    expect(screen.queryByText('🐈')).toBeNull()
  })
})

describe('Given a card that unmounts and mounts again (tab switch)', () => {
  function setup() {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number | null) => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard
          provider="claude"
          status="ready"
          errorMessage={null}
          report={buildUsageView(value === null ? {} : { five_hour: { utilization: value } })}
        />
      </UsageGatewayProvider>
    )
    return {
      view,
      scheduler,
      advance(ms: number) {
        now = new Date(Date.parse(now) + ms).toISOString()
      },
    }
  }

  it('When the value changed while away Then the cat runs from the retained baseline', () => {
    const { view, advance } = setup()
    const mounted = render(view(10))
    expect(screen.queryByText('🐈')).toBeNull()

    mounted.rerender(view(null))
    advance(60_000)
    mounted.rerender(view(12))

    expect(screen.getByText('🐈').parentElement?.style.animationDuration).toBe('4s')
  })

  it('When a running cat remounts before expiry Then it resumes and stops at the original expiry', () => {
    const { view, scheduler, advance } = setup()
    const mounted = render(view(10))
    advance(60_000)
    mounted.rerender(view(12))
    expect(screen.getByText('🐈').parentElement?.style.animationDuration).toBe('4s')

    mounted.rerender(view(null))
    advance(120_000)
    mounted.rerender(view(12))
    expect(screen.getByText('🐈').parentElement?.style.animationDuration).toBe('4s')

    act(() => scheduler.runScheduledAt(180_000))
    expect(screen.queryByText('🐈')).toBeNull()
  })
})
