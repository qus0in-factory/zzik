// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render as baseRender, screen, within } from '@testing-library/react'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import liveClaude from '../../fixtures/claude-usage.live-scoped.json'
import liveCodex from '../../fixtures/codex-usage.live.json'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'
import codexUnknownRaw from '../../fixtures/codex-usage.unknown-keys.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

const deps = { gateway: createFakeUsageGateway(), clock: { nowIso: () => NOW_ISO }, scheduler: createFakeUsageScheduler() }
function render(element: ReactElement) {
  return baseRender(<UsageGatewayProvider deps={deps}>{element}</UsageGatewayProvider>)
}
afterEach(cleanup)

/** 렌더된 한도 카드의 id를 DOM 순서대로 모은다. */
function cardIds(): string[] {
  return screen.getAllByTestId('usage-card').map((card) => card.getAttribute('data-card-id') ?? '')
}

/** 렌더된 기타 항목의 id를 DOM 순서대로 모은다. */
function otherIds(): string[] {
  return screen.queryAllByTestId('usage-other').map((card) => card.getAttribute('data-other-id') ?? '')
}

describe('Given the usage dashboard with the unknown keys report', () => {
  it('When rendering then only populated limit keys get cards (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getAllByTestId('usage-card')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: /Raw|JSON/i })).toBeNull()
    expect(screen.queryByText(/Raw JSON/)).toBeNull()
    expect(screen.getByText('주간 · Haiku')).toBeTruthy()
    expect(screen.getByText('주간 · Haiku')).toBeTruthy()
    expect(screen.getAllByText('thirty_day').length).toBeGreaterThanOrEqual(1)
  })

  it('When a metric has no data then its card is hidden (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.queryByText('Cowork 주간')).toBeNull()
    expect(screen.queryByText('정보 없음')).toBeNull()
  })

  it('When rendering unknown metric cards then they carry the unverified badge and known ones do not (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const fableLabel = screen.getByText('주간 · Haiku')
    const fableCard = fableLabel.closest('[data-testid="usage-card"]') as HTMLElement
    expect(fableCard.textContent).toContain('미확인')
    const opusCard = (screen.getByText('Sonnet 주간').closest('[data-testid="usage-card"]') as HTMLElement)
    expect(opusCard.textContent).not.toContain('미확인')
  })

  it('When rendering then the grids stay single column at 320px (U8)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    for (const grid of screen.getAllByTestId('usage-grid-claude')) {
      expect(grid.className).toContain('grid-cols-1')
      expect(grid.className).not.toMatch(/(?:^|\s)grid-cols-[23]/)
      expect(grid.className).not.toContain('overflow-x-auto')
    }
    for (const card of screen.getAllByTestId('usage-card')) {
      expect(card.className).toContain('min-w-0')
    }
    for (const label of screen.getAllByTestId('usage-card-label')) {
      expect(label.className).toMatch(/break-words|truncate/)
    }
  })

  it('When rendering then the section is labeled and card titles are h3 (U9)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(
      <UsageDashboard
        provider="claude"
        ariaLabel="Claude 사용량"
        status="ready"
        report={report}
        lastSuccessText="마지막 수집 11:58 (2분 전)"
        errorMessage={null}
      />,
    )
    expect(screen.getByLabelText('Claude 사용량')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(6)
  })

  it('When a report is ready then card ids match populated domain entries in order', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)

    const expected = [
      'five_hour',
      'seven_day',
      'seven_day_sonnet',
      'seven_day_fake',
      'seven_day_haiku',
      'thirty_day',
    ]
    expect(cardIds()).toEqual(expected)
    expect(cardIds()).toEqual([...report.windows.map((item) => item.id), ...report.metrics.map((item) => item.id)])
    expect(new Set(cardIds()).size).toBe(expected.length)
    expect(otherIds()).toEqual([])
    expect([...cardIds(), ...otherIds()].sort()).toEqual(Object.entries(unknownKeysRaw).filter(([key, value]) => value !== null && key !== 'extra_usage').map(([key]) => key).sort())
  })

  it('When the normal fixture renders then its card ids are the documented order', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(cardIds()).toEqual(['five_hour', 'seven_day', 'seven_day_sonnet'])
  })

  it('When limit and non-limit keys are mixed then only limit cards render and others are excluded from the screen', () => {
    const mixedRaw = {
      five_hour: { utilization: 10, resets_at: '2026-11-11T14:00:00.000Z' },
      seven_day: null,
      seven_day_opus: null,
      extra_usage: { utilization: 5 },
      note: 'hello',
      blob: { foo: 'bar' },
      list: [1, 2, 3],
      empty_object: {},
    }
    const report = buildUsageView(mixedRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)

    expect(cardIds()).toEqual(['five_hour'])
    expect(otherIds()).toEqual([])
    expect(screen.queryByTestId('usage-other')).toBeNull()
    expect(screen.queryByText('기타 항목')).toBeNull()
  })
})

const readyReport = buildUsageView(normalRaw, { now: NOW })

describe('Given the loading state', () => {
  it('When no data has arrived yet then skeletons render without value text (U4)', () => {
    render(<UsageDashboard provider="claude" status="loading" report={null} errorMessage={null} />)
    const busy = screen.getByTestId('usage-section-claude')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('37%')).toBeNull()
    expect(screen.queryByText('정보 없음')).toBeNull()
  })
  it('When loading Then the skeleton keeps the real layout: title, status row, and a two-column card grid with card-shaped placeholders', () => {
    render(<UsageDashboard provider="claude" title="Claude" status="loading" report={null} errorMessage={null} />)
    const section = screen.getByTestId('usage-section-claude')
    expect(screen.getByRole('heading', { name: 'Claude', level: 2 })).toBeTruthy()
    expect(within(section).getByTestId('usage-skeleton-status')).toBeTruthy()
    const grid = within(section).getByTestId('usage-skeleton-grid')
    // 첫 카드 그룹은 소제목 없이 바로 격자다(실제 화면과 같은 구조라 첫 카드 top이 같다)
    expect(grid.parentElement?.firstElementChild).toBe(grid)
    expect(grid.className).toContain('sm:grid-cols-2')
    expect(grid.querySelectorAll('[data-testid="usage-skeleton-card"]').length).toBe(2)
    // 실제 카드와 같은 외형(테두리 카드)이라 데이터가 들어와도 높이가 비슷하다
    expect(grid.querySelector('[data-testid="usage-skeleton-card"]')?.className).toContain('rounded-xl')
    expect(grid.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
  it('When data is on screen and a refresh runs Then no skeleton, the button is disabled with a spinner and busy state', () => {
    const onRetry = vi.fn()
    render(<UsageDashboard provider="claude" status="ready" report={readyReport} errorMessage={null} refreshing onRetry={onRetry} />)
    expect(screen.queryByTestId('usage-skeleton-grid')).toBeNull()
    const button = screen.getByRole('button', { name: /새로고침/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(within(button).getByTestId('refresh-spinner')).toBeTruthy()
    fireEvent.click(button)
    expect(onRetry).not.toHaveBeenCalled()
  })
  it('When not refreshing Then the button is enabled without a spinner', () => {
    render(<UsageDashboard provider="claude" status="ready" report={readyReport} errorMessage={null} onRetry={() => {}} />)
    const button = screen.getByRole('button', { name: /새로고침/ }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    expect(screen.queryByTestId('refresh-spinner')).toBeNull()
  })
})

describe('Given the error state', () => {
  it('When loading fails then the message and a retry button show up (U5)', () => {
    const onRetry = vi.fn()
    render(<UsageDashboard provider="claude" status="error" report={null} errorMessage="사용량을 불러오지 못했습니다" onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain('사용량을 불러오지 못했습니다')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('When a retry keeps an old report then cards still show with the error (U5)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="error" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage="사용량을 불러오지 못했습니다" />)
    expect(screen.getByRole('alert').textContent).toContain('사용량을 불러오지 못했습니다')
    expect(screen.getAllByTestId('usage-card')).toHaveLength(3)
  })
})

describe('Given the stale state', () => {
  it('When the last load is old then the stale badge, the age and the kept cards show up (U6)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(
      <UsageDashboard
        provider="claude"
        title="Claude"
        status="stale"
        report={report}
        errorMessage={null}
        lastSuccessText="마지막 수집 11:58 (2분 전)"
        staleNoteText="마지막 성공 2분 전"
      />,
    )
    const light = screen.getByTestId('provider-status')
    expect(light.getAttribute('data-level')).toBe('caution')
    expect(light.getAttribute('title')).toBe('오래된 데이터 · 마지막 수집 11:58 (2분 전)')
    expect(screen.getByText('마지막 성공 2분 전')).toBeTruthy()
    expect(screen.getByText('37%')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('마지막 성공 2분 전')
  })
})

describe('Given an empty report', () => {
  it('When nothing collected yet then the empty message shows without alert semantics (U10)', () => {
    render(<UsageDashboard provider="claude" status="ready" report={{ status: 'unknown', windows: [], metrics: [], others: [], issues: [], raw: {} }} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getByText('표시할 사용량이 없습니다')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('When report has only other entries and 0 windows/metrics then empty message shows and no headings remain', () => {
    const reportWithOthersOnly = {
      status: 'unknown' as const,
      windows: [],
      metrics: [],
      others: [{ id: 'plan_type', label: 'Plan Type', value: { kind: 'value' as const, text: 'pro' } }],
      issues: [],
      raw: {},
    }
    render(<UsageDashboard provider="claude" status="ready" report={reportWithOthersOnly} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getByText('표시할 사용량이 없습니다')).toBeTruthy()
    expect(screen.queryByText('사용 창')).toBeNull()
    expect(screen.queryByText('모델·기능별 한도')).toBeNull()
    expect(screen.queryByText('기타 항목')).toBeNull()
    expect(screen.queryAllByTestId('usage-card')).toHaveLength(0)
    expect(screen.queryAllByTestId('usage-other')).toHaveLength(0)
  })
})

describe('Given the codex section (ADR 0.3 D6·D8)', () => {
  const report = buildCodexUsageView(codexUnknownRaw, { now: NOW, fetchedAt: NOW_ISO })

  it('When rendering then the extra limit block uses the provider specific title', () => {
    render(
      <UsageDashboard
        provider="codex"
        title="ChatGPT (Codex)"
        metricsTitle="추가 한도"
        sectionId="usage-codex"
        ariaLabel="ChatGPT 사용량"
        status="ready"
        report={report}
        errorMessage={null}
      />,
    )
    expect(screen.queryByRole('heading', { name: '사용 창' })).toBeNull()
    expect(screen.getByRole('heading', { name: '추가 한도', level: 3 })).toBeTruthy()
    expect(screen.getByTestId('usage-section-codex').getAttribute('aria-label')).toBe('ChatGPT 사용량')
  })

  it('When a window length is unverified then the card carries the unverified badge', () => {
    render(<UsageDashboard provider="codex" status="ready" report={report} errorMessage={null} />)
    const card = screen.getAllByTestId('usage-card').find((element) => element.getAttribute('data-card-id') === 'rate_limit.primary_window')
    expect(card?.textContent).toContain('미확인')
    expect(card?.textContent).toContain('3시간 한도')
  })

  it('When json path ids are long then they are hidden from the card, opened from the info button, and wrap in the tooltip', async () => {
    render(<UsageDashboard provider="codex" status="ready" report={report} errorMessage={null} />)
    // 원본 속성 이름은 눈에 보이는 code가 아니라 sr-only 설명(aria-describedby)과 툴팁에만 있다
    expect(document.querySelector('[data-testid="usage-card"] code')).toBeNull()
    const button = screen.getAllByTestId('usage-card-info')[0]
    const describedBy = button.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.className).toContain('sr-only')
    expect(document.getElementById(describedBy)?.textContent).toMatch(/rate_limit|mcp|code_review/)
    fireEvent.click(button)
    expect((await screen.findAllByTestId('usage-card-info-content'))[0].className).toContain('break-all')
    expect(screen.getByTestId('usage-section-codex').className).not.toContain('overflow-x-auto')
  })

  it('When the provider is stale then the refresh hint appears', () => {
    render(
      <UsageDashboard
        provider="codex"
        refreshHint="이 Mac에서 Codex를 실행하면 갱신된다"
        status="stale"
        report={report}
        errorMessage={null}
        staleNoteText="마지막 성공 2분 전"
      />,
    )
    expect(screen.getByTestId('provider-hint').textContent).toContain('Codex를 실행하면')
  })
})

describe('Given the collection note and 320px layout (ADR 0.3 v2 D8)', () => {
  it('When a collection note is given then it is rendered as plain informational text', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(
      <UsageDashboard
        provider="claude"
        status="stale"
        report={report}
        errorMessage={null}
        collectionNote="이 Mac에서 Claude Code를 실행하면 갱신됩니다."
      />,
    )
    const note = screen.getByTestId('collection-note')
    expect(note.textContent).toContain('실행하면 갱신됩니다')
    expect(note.className).toContain('break-words')
    expect(note.className).toContain('min-w-0')
    // stale 안내(role=status)와 섞이지 않는다: plain 문단이므로 status 역할을 만들지 않는다.
    expect(note.getAttribute('role')).toBeNull()
  })

  it('When there is no note then the note element is absent', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} errorMessage={null} collectionNote={null} />)
    expect(screen.queryByTestId('collection-note')).toBeNull()
  })

  it('When an error message is long then the alert box wraps instead of overflowing at 320px', () => {
    render(
      <UsageDashboard
        provider="claude"
        status="error"
        report={null}
        errorMessage={'아주 긴 오류 문구 '.repeat(20)}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('min-w-0')
    expect(alert.querySelector('[data-testid="usage-error-text"]')?.className).toContain('break-words')
  })

  it('When the grids render at 320px then they stay single column without horizontal scroll', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} errorMessage={null} />)
    for (const grid of screen.getAllByTestId('usage-grid-claude')) {
      expect(grid.className).toContain('grid-cols-1')
      expect(grid.className).not.toMatch(/(?:^|\s)grid-cols-[23]/)
      expect(grid.className).not.toContain('overflow-x-auto')
    }
    for (const bar of screen.getAllByRole('progressbar')) {
      expect(bar.parentElement?.className).toContain('min-w-0')
    }
  })
})

describe('Given live provider reports after the display policy', () => {
  it('When Claude renders Then only 5시간·주간·Fable 주간 cards appear and other items/Raw JSON are absent', () => {
    const report = buildUsageView(liveClaude, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} errorMessage={null} />)
    expect(cardIds()).toEqual(['five_hour', 'seven_day', 'seven_day_fable'])
    expect(screen.getByText('5시간 한도')).toBeTruthy()
    expect(screen.getByText('주간 한도')).toBeTruthy()
    expect(screen.getByText('Fable 주간')).toBeTruthy()
    expect(otherIds()).toEqual([])
    expect(screen.queryByTestId('usage-other')).toBeNull()
    expect(screen.queryByText('기타 항목')).toBeNull()
    expect(screen.queryByTestId('extra-spend')).toBeNull()
    expect(screen.queryByRole('button', { name: /Raw|JSON/i })).toBeNull()
    expect(document.querySelector('pre')).toBeNull()
  })

  it('When Codex renders Then only 주간 card appears and other items/Raw JSON are absent', () => {
    const report = buildCodexUsageView(liveCodex, { now: NOW })
    render(<UsageDashboard provider="codex" status="ready" report={report} errorMessage={null} />)
    expect(cardIds()).toEqual(['rate_limit.primary_window'])
    expect(screen.getByText('주간 한도')).toBeTruthy()
    expect(otherIds()).toEqual([])
    expect(screen.queryByTestId('usage-other')).toBeNull()
    expect(screen.queryByText('기타 항목')).toBeNull()
    expect(screen.queryByText('정보 없음')).toBeNull()
    expect(screen.queryByRole('button', { name: /Raw|JSON/i })).toBeNull()
    expect(document.querySelector('pre')).toBeNull()
  })
})

describe('Given the section title row (제목 줄 레이아웃)', () => {
  it('When ready Then the last-collection text and the refresh button sit in the same row as the icon, title and light', () => {
    render(<UsageDashboard provider="claude" title="Claude" status="ready" report={readyReport} errorMessage={null} lastSuccessText="마지막 수집 10:09 (7분 전)" onRetry={() => {}} />)
    const row = screen.getByRole('heading', { name: 'Claude', level: 2 }).parentElement?.parentElement as HTMLElement
    expect(row.className).toContain('flex-wrap')
    expect(within(row).getByTestId('provider-icon-claude')).toBeTruthy()
    expect(within(row).getByTestId('provider-status')).toBeTruthy()
    expect(within(row).getByText('마지막 수집 10:09 (7분 전)')).toBeTruthy()
    expect(within(row).getByRole('button', { name: /새로고침/ })).toBeTruthy()
  })
  it('When the load failed Then the auto-refresh hint lives inside the error box, not as a loose paragraph', () => {
    render(<UsageDashboard provider="claude" title="Claude" refreshHint="수집기가 15분마다 자동으로 갱신합니다." status="error" report={null} errorMessage="오류" />)
    expect(within(screen.getByRole('alert')).getByTestId('provider-hint').textContent).toContain('15분마다')
  })
})

