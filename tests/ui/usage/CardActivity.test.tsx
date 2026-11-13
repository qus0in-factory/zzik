// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW_ISO } from '../../fakes/usage-ports'
afterEach(cleanup)
describe('Given a mounted usage card', () => {
  it('When values change Then runs at the new speed and rests in idle pose at expiry', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number) => <UsageGatewayProvider deps={deps}><UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization: value } })} /></UsageGatewayProvider>
    const mounted = render(view(10))
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('idle')
    expect(screen.queryByText('🐈')).toBeNull()

    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(12))
    const catRunner = screen.getByTestId('activity-cat')
    expect(catRunner.style.getPropertyValue('--cat-lap')).toBe('0.6s')
    expect(catRunner.style.left).toBe('12%')
    expect(catRunner.getAttribute('data-cat-state')).toBe('running')
    expect(screen.queryByText('🐈')).toBeNull()
    expect(catRunner.querySelector('svg')).toBeTruthy()

    mounted.rerender(view(22))
    expect(screen.getByTestId('activity-cat').style.getPropertyValue('--cat-lap')).toBe('0.25s')
    expect(screen.getByTestId('activity-cat').style.left).toBe('22%')

    act(() => scheduler.runScheduledAt(300_000))
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('idle')
  })

  it('When value is zero or changes to zero Then the cat sleeps (and no card means no cat)', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number | null) => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView(value === null ? {} : { five_hour: { utilization: value } })} />
      </UsageGatewayProvider>
    )
    const mounted = render(view(0))
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('sleeping')

    // 0 -> 10: 양수 변화로 활성화
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(10))
    expect(screen.getByTestId('activity-cat')).toBeTruthy()

    // 10 -> 12: 추가 변화로 활성 유지
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-cat')).toBeTruthy()

    // 12 -> 0: 활성 중 0으로 떨어지면 즉시 숨김
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(0))
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('sleeping')

    // 0 -> 15: 다시 양수 변화 시 재활성화
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(15))
    expect(screen.getByTestId('activity-cat')).toBeTruthy()

    // 15 -> null: 활성 중 null로 전환 시 즉시 숨김
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(null))
    expect(screen.queryByTestId('activity-cat')).toBeNull()
  })

  it('When rendered Then cat sits in the same relative container as Progress with matching coordinate left', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number) => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization: value } })} />
      </UsageGatewayProvider>
    )
    const mounted = render(view(10))
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(37))

    const catRunner = screen.getByTestId('activity-cat')
    const track = catRunner.parentElement
    const progress = screen.getByRole('progressbar')
    // 고양이 트랙과 Progress는 동일한 relative 부모 컨테이너를 공유해야 함 (좌표계 일치)
    expect(track?.parentElement).toBe(progress.parentElement)
    expect(catRunner.style.left).toBe('37%')

    // 증가(37% -> 80%) 및 감소(80% -> 20%) 양방향에서 좌표와 transition 스타일 일치 검증
    mounted.rerender(view(80))
    expect(catRunner.style.left).toBe('80%')

    mounted.rerender(view(20))
    expect(catRunner.style.left).toBe('20%')

    // Progress 인디케이터 transition 클래스/속성 확인
    const indicator = progress.querySelector('[data-slot="progress-indicator"]')
    expect(indicator?.className).toContain('progress-indicator-transition')
  })

  it('When value exceeds 100 Then cat position is clamped to 100%', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number) => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization: value } })} />
      </UsageGatewayProvider>
    )
    const mounted = render(view(10))
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(105))
    expect(screen.getByTestId('activity-cat').style.left).toBe('100%')
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
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('idle')

    mounted.rerender(view(null))
    advance(60_000)
    mounted.rerender(view(12))

    expect(screen.getByTestId('activity-cat').style.getPropertyValue('--cat-lap')).toBe('0.6s')
  })

  it('When a running cat remounts before expiry Then it resumes and stops at the original expiry', () => {
    const { view, scheduler, advance } = setup()
    const mounted = render(view(10))
    advance(60_000)
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-cat').style.getPropertyValue('--cat-lap')).toBe('0.6s')

    mounted.rerender(view(null))
    advance(120_000)
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-cat').style.getPropertyValue('--cat-lap')).toBe('0.6s')

    act(() => scheduler.runScheduledAt(180_000))
    expect(screen.getByTestId('activity-cat').getAttribute('data-cat-state')).toBe('idle')
  })
})

describe('Given the cat and bar presentation rules', () => {
  const dashboard = (utilization: number) => (
    <UsageGatewayProvider deps={{ gateway: createFakeUsageGateway(), scheduler: createFakeUsageScheduler(), clock: { nowIso: () => NOW_ISO } }}>
      <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization } })} />
    </UsageGatewayProvider>
  )
  it('When the value is positive without recent change Then the idle cat shows with top padding and no lap speed', () => {
    render(dashboard(30))
    const cat = screen.getByTestId('activity-cat')
    expect(cat.getAttribute('data-cat-state')).toBe('idle')
    expect(cat.style.getPropertyValue('--cat-lap')).toBe('')
    expect(screen.getByTestId('usage-bar').className).toContain('pt-5')
  })
  it('When the value is 0 Then the cat sleeps at the bar start in neutral gray, padding kept', () => {
    render(dashboard(0))
    const cat = screen.getByTestId('activity-cat')
    expect(cat.getAttribute('data-cat-state')).toBe('sleeping')
    expect(cat.style.left).toBe('0%')
    expect(cat.querySelector('.cat-sleep-z')).toBeTruthy()
    expect(screen.getByTestId('usage-bar').className).toContain('pt-5')
    expect(screen.getByTestId('usage-bar').getAttribute('data-bar-level')).toBe('neutral')
  })
  it('When the bar has a level Then the state is in the aria-label as text, not only color', () => {
    render(dashboard(95))
    expect(screen.getByTestId('usage-bar').getAttribute('data-bar-level')).toBe('danger')
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toContain('상태 위험')
  })
  it('When reduced motion is requested Then the cat stays and every cat animation stops, sleeping breathing included', () => {
    const css = readFileSync('src/ui/usage/activity-cat.css', 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'))
    expect(reduced).not.toContain('display: none')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('.cat-sleep-body')
  })
})
