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
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('idle')
    expect(screen.queryByText('🐈')).toBeNull()

    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(12))
    const gerbilRunner = screen.getByTestId('activity-gerbil')
    expect(gerbilRunner.style.getPropertyValue('--gerbil-lap')).toBe('0.6s')
    expect(gerbilRunner.style.left).toBe('12%')
    expect(gerbilRunner.getAttribute('data-gerbil-state')).toBe('running')
    expect(screen.queryByText('🐈')).toBeNull()
    expect(gerbilRunner.querySelector('svg')).toBeTruthy()

    mounted.rerender(view(22))
    expect(screen.getByTestId('activity-gerbil').style.getPropertyValue('--gerbil-lap')).toBe('0.25s')
    expect(screen.getByTestId('activity-gerbil').style.left).toBe('22%')

    act(() => scheduler.runScheduledAt(300_000))
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('idle')
  })

  it('When value is zero or changes to zero Then the gerbil sleeps (and no card means no gerbil)', () => {
    let now = NOW_ISO
    const scheduler = createFakeUsageScheduler()
    const deps = { gateway: createFakeUsageGateway(), scheduler, clock: { nowIso: () => now } }
    const view = (value: number | null) => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView(value === null ? {} : { five_hour: { utilization: value } })} />
      </UsageGatewayProvider>
    )
    const mounted = render(view(0))
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('sleeping')

    // 0 -> 10: 양수 변화로 활성화
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(10))
    expect(screen.getByTestId('activity-gerbil')).toBeTruthy()

    // 10 -> 12: 추가 변화로 활성 유지
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-gerbil')).toBeTruthy()

    // 12 -> 0: 활성 중 0으로 떨어지면 즉시 숨김
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(0))
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('sleeping')

    // 0 -> 15: 다시 양수 변화 시 재활성화
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(15))
    expect(screen.getByTestId('activity-gerbil')).toBeTruthy()

    // 15 -> null: 활성 중 null로 전환 시 즉시 숨김
    now = new Date(Date.parse(now) + 60_000).toISOString()
    mounted.rerender(view(null))
    expect(screen.queryByTestId('activity-gerbil')).toBeNull()
  })

  it('When rendered Then gerbil sits in the same relative container as Progress with matching coordinate left', () => {
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

    const gerbilRunner = screen.getByTestId('activity-gerbil')
    const track = gerbilRunner.parentElement
    const progress = screen.getByRole('progressbar')
    // 저빌 트랙과 Progress는 동일한 relative 부모 컨테이너를 공유해야 함 (좌표계 일치)
    expect(track?.parentElement).toBe(progress.parentElement)
    expect(gerbilRunner.style.left).toBe('37%')

    // 증가(37% -> 80%) 및 감소(80% -> 20%) 양방향에서 좌표와 transition 스타일 일치 검증
    mounted.rerender(view(80))
    expect(gerbilRunner.style.left).toBe('80%')

    mounted.rerender(view(20))
    expect(gerbilRunner.style.left).toBe('20%')

    // Progress 인디케이터 transition 클래스/속성 확인
    const indicator = progress.querySelector('[data-slot="progress-indicator"]')
    expect(indicator?.className).toContain('progress-indicator-transition')
  })

  it('When value exceeds 100 Then gerbil position is clamped to 100%', () => {
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
    expect(screen.getByTestId('activity-gerbil').style.left).toBe('100%')
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

  it('When the value changed while away Then the gerbil runs from the retained baseline', () => {
    const { view, advance } = setup()
    const mounted = render(view(10))
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('idle')

    mounted.rerender(view(null))
    advance(60_000)
    mounted.rerender(view(12))

    expect(screen.getByTestId('activity-gerbil').style.getPropertyValue('--gerbil-lap')).toBe('0.6s')
  })

  it('When a running gerbil remounts before expiry Then it resumes and stops at the original expiry', () => {
    const { view, scheduler, advance } = setup()
    const mounted = render(view(10))
    advance(60_000)
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-gerbil').style.getPropertyValue('--gerbil-lap')).toBe('0.6s')

    mounted.rerender(view(null))
    advance(120_000)
    mounted.rerender(view(12))
    expect(screen.getByTestId('activity-gerbil').style.getPropertyValue('--gerbil-lap')).toBe('0.6s')

    act(() => scheduler.runScheduledAt(180_000))
    expect(screen.getByTestId('activity-gerbil').getAttribute('data-gerbil-state')).toBe('idle')
  })
})

describe('Given the gerbil and bar presentation rules', () => {
  const dashboard = (utilization: number) => (
    <UsageGatewayProvider deps={{ gateway: createFakeUsageGateway(), scheduler: createFakeUsageScheduler(), clock: { nowIso: () => NOW_ISO } }}>
      <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization } })} />
    </UsageGatewayProvider>
  )
  it('When the value is positive without recent change Then the idle gerbil shows with top padding and no lap speed', () => {
    render(dashboard(30))
    const gerbil = screen.getByTestId('activity-gerbil')
    expect(gerbil.getAttribute('data-gerbil-state')).toBe('idle')
    expect(gerbil.style.getPropertyValue('--gerbil-lap')).toBe('')
    expect(screen.getByTestId('usage-bar').className).toContain('pt-[1.625rem]')
  })
  it('When the value is 0 Then the gerbil sleeps at the bar start in neutral gray, padding kept', () => {
    render(dashboard(0))
    const gerbil = screen.getByTestId('activity-gerbil')
    expect(gerbil.getAttribute('data-gerbil-state')).toBe('sleeping')
    expect(gerbil.style.left).toBe('0%')
    expect(gerbil.querySelector('.gerbil-sleep-z')).toBeTruthy()
    expect(screen.getByTestId('usage-bar').className).toContain('pt-[1.625rem]')
    expect(screen.getByTestId('usage-bar').getAttribute('data-bar-level')).toBe('neutral')
  })
  it('When the bar has a level Then the state is in the aria-label as text, not only color', () => {
    render(dashboard(95))
    expect(screen.getByTestId('usage-bar').getAttribute('data-bar-level')).toBe('danger')
    expect(screen.getByRole('progressbar').getAttribute('aria-label')).toContain('상태 위험')
  })
  it('When reduced motion is requested Then the gerbil stays and every gerbil animation stops, sleeping breathing included', () => {
    const css = readFileSync('src/ui/usage/activity-gerbil.css', 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'))
    expect(reduced).not.toContain('display: none')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('.gerbil-sleep-body')
    // idle 꼬리 규칙은 특이도가 높아 reduced-motion에서도 같은 선택자로 꺼야 한다
    expect(reduced).toContain(".activity-gerbil-runner[data-gerbil-state='idle'] .gerbil-part-tail")
    // 진입 연출(다리·몸)도 같은 이유로 idle 선택자로 꺼야 한다
    for (const part of ['.gerbil-leg-front-left', '.gerbil-leg-front-right', '.activity-gerbil-svg']) expect(reduced).toContain(`.activity-gerbil-runner[data-gerbil-state='idle'] ${part}`)
  })
  it('When idle Then the tail sways ±20° every 1.3s around its root; legs and body only run during the entrance', () => {
    const css = readFileSync('src/ui/usage/activity-gerbil.css', 'utf8')
    expect(css).toMatch(/\.activity-gerbil-runner\[data-gerbil-state='idle'\] \.gerbil-part-tail \{\s*animation: gerbil-tail-sway 1\.3s ease-in-out infinite;/)
    expect(css).toMatch(/@keyframes gerbil-tail-sway\s*\{[^}]*rotate\(-20deg\)[\s\S]*rotate\(20deg\)/)
    expect(css).toMatch(/\.gerbil-part-tail \{\s*transform-box: view-box;\s*transform-origin: 9\.5px 9\.5px;/)
    // 입장 때만 달리고(유한 반복) 이후 정지: idle 다리·몸 애니메이션은 infinite가 아니다
    const idleLegs = /\.activity-gerbil-runner\[data-gerbil-state='idle'\] \.gerbil-leg-front-left[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(idleLegs).toMatch(/gerbil-leg-swing-a var\(--motion-enter-lap\) ease-in-out 2 /)
    expect(idleLegs).not.toContain('infinite')
  })
  it('When the gerbil enters Then it runs from 0% to its target with the bar (same duration, delay and easing) and is larger (40x25)', () => {
    const css = readFileSync('src/ui/usage/activity-gerbil.css', 'utf8')
    expect(css).toMatch(/@keyframes gerbil-enter\s*\{\s*from\s*\{\s*left:\s*0%/)
    expect(css).toMatch(/\.activity-gerbil-runner\s*\{[^}]*animation:\s*gerbil-enter var\(--motion-enter\) ease-out backwards/)
    expect(css).toMatch(/\.activity-gerbil-runner\s*\{[^}]*width:\s*2\.5rem;\s*height:\s*1\.5625rem;/)
  })
})

describe('Given the entrance motion on a card', () => {
  const dashboard = (value: number) => (
    <UsageGatewayProvider deps={{ gateway: createFakeUsageGateway(), scheduler: createFakeUsageScheduler(), clock: { nowIso: () => NOW_ISO } }}>
      <UsageDashboard provider="claude" status="ready" errorMessage={null} report={buildUsageView({ five_hour: { utilization: value }, seven_day: { utilization: value }, seven_day_sonnet: { utilization: value } })} />
    </UsageGatewayProvider>
  )
  it('When mounted Then the bar indicator fills via bar-enter and cards are staggered by index', () => {
    render(dashboard(40))
    const cards = screen.getAllByTestId('usage-card')
    expect(cards.map((card) => card.style.getPropertyValue('--enter-index'))).toEqual(['0', '1', '0'])
    for (const card of cards) {
      expect(card.className).toContain('fade-in')
      expect(card.querySelector('[data-slot="progress-indicator"]')?.className).toContain('bar-enter')
    }
  })
  it('When the value is refreshed Then the same DOM nodes are kept, so the entrance does not replay (the normal transition moves them)', () => {
    const mounted = render(dashboard(40))
    const bar = screen.getAllByTestId('usage-card')[0].querySelector('[data-slot="progress-indicator"]')
    const runner = screen.getAllByTestId('activity-gerbil')[0]
    mounted.rerender(dashboard(55))
    expect(screen.getAllByTestId('usage-card')[0].querySelector('[data-slot="progress-indicator"]')).toBe(bar)
    expect(screen.getAllByTestId('activity-gerbil')[0]).toBe(runner)
    expect(runner.style.left).toBe('55%')
  })
  it('When the section goes from loading to ready Then the cards mount fresh (fade-in plays again)', () => {
    const deps = { gateway: createFakeUsageGateway(), scheduler: createFakeUsageScheduler(), clock: { nowIso: () => NOW_ISO } }
    const view = (status: 'loading' | 'ready') => (
      <UsageGatewayProvider deps={deps}>
        <UsageDashboard provider="claude" status={status} errorMessage={null} report={status === 'ready' ? buildUsageView({ five_hour: { utilization: 10 } }) : null} />
      </UsageGatewayProvider>
    )
    const mounted = render(view('loading'))
    expect(screen.queryByTestId('usage-card')).toBeNull()
    mounted.rerender(view('ready'))
    expect(screen.getByTestId('usage-card').className).toContain('fade-in')
  })
})

describe('Given the index.html cache policy (public/_headers for Workers static assets)', () => {
  const headers = readFileSync('public/_headers', 'utf8')
  it('Then the HTML shell is revalidated every time while hashed assets are immutable', () => {
    expect(headers).toMatch(/^\/\n\s+Cache-Control: no-cache$/m)
    expect(headers).toMatch(/^\/index\.html\n\s+Cache-Control: no-cache$/m)
    expect(headers).toMatch(/^\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m)
  })
})
