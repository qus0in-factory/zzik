// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import { buildCodexUsageView } from '@domain/usage/codex-view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'
import codexUnknownRaw from '../../fixtures/codex-usage.unknown-keys.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

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
  it('When rendering then every top level key of the raw response gets a card (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getAllByTestId('usage-card')).toHaveLength(9)
    expect(screen.getByText('주간 · Haiku')).toBeTruthy()
    expect(screen.getByText('주간 · Haiku')).toBeTruthy()
    expect(screen.getAllByText('thirty_day').length).toBeGreaterThanOrEqual(1)
  })

  it('When rendering a null valued card then it shows no value instead of 0% (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const coworkLabel = screen.getByText('Cowork 주간')
    const card = coworkLabel.closest('[data-testid="usage-card"]') as HTMLElement
    expect(card.textContent).toContain('정보 없음')
    expect(card.textContent).not.toContain('0%')
  })

  it('When rendering unknown metric cards then they carry the unverified badge and known ones do not (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const fableLabel = screen.getByText('주간 · Haiku')
    const fableCard = fableLabel.closest('[data-testid="usage-card"]') as HTMLElement
    expect(fableCard.textContent).toContain('미확인')
    const opusCard = (screen.getByText('Opus 주간').closest('[data-testid="usage-card"]') as HTMLElement)
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
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(9)
  })

  it('When a report is ready then card ids match the raw keys exactly and in order (완전성 불변식)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)

    const expected = [
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'seven_day_sonnet',
      'seven_day_cowork',
      'extra_usage',
      'seven_day_fake',
      'seven_day_haiku',
      'thirty_day',
    ]
    expect(cardIds()).toEqual(expected)
    expect(cardIds()).toEqual([...report.windows.map((item) => item.id), ...report.metrics.map((item) => item.id)])
    expect(new Set(cardIds()).size).toBe(expected.length)
    expect(otherIds()).toEqual([])
    expect([...cardIds(), ...otherIds()].sort()).toEqual(Object.keys(unknownKeysRaw).sort())
  })

  it('When the normal fixture renders then its card ids are the documented order', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard provider="claude" status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(cardIds()).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'extra_usage'])
  })

  it('When limit and non-limit keys are mixed then cards plus other items cover every raw key exactly once', () => {
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

    expect(cardIds()).toEqual(['five_hour', 'seven_day', 'seven_day_opus', 'extra_usage'])
    expect(otherIds()).toEqual(['note', 'blob', 'list', 'empty_object'])
    const rendered = [...cardIds(), ...otherIds()]
    expect(rendered).toHaveLength(Object.keys(mixedRaw).length)
    expect(rendered.slice().sort()).toEqual(Object.keys(mixedRaw).sort())
  })
})

describe('Given the loading state', () => {
  it('When no data has arrived yet then skeletons render without value text (U4)', () => {
    render(<UsageDashboard provider="claude" status="loading" report={null} errorMessage={null} />)
    const busy = screen.getByTestId('usage-section-claude')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('[data-testid="usage-skeleton"]').length).toBe(3)
    expect(screen.queryByText('37%')).toBeNull()
    expect(screen.queryByText('정보 없음')).toBeNull()
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
    expect(screen.getAllByTestId('usage-card')).toHaveLength(5)
  })
})

describe('Given the stale state', () => {
  it('When the last load is old then the stale badge, the age and the kept cards show up (U6)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(
      <UsageDashboard
        provider="claude"
        status="stale"
        report={report}
        errorMessage={null}
        lastSuccessText="마지막 수집 11:58 (2분 전)"
        staleNoteText="마지막 성공 2분 전"
      />,
    )
    expect(screen.getByText('오래된 데이터')).toBeTruthy()
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
    expect(screen.getByRole('heading', { name: '사용 창', level: 3 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '추가 한도', level: 3 })).toBeTruthy()
    expect(screen.getByTestId('usage-section-codex').getAttribute('aria-label')).toBe('ChatGPT 사용량')
  })

  it('When a window length is unverified then the card carries the unverified badge', () => {
    render(<UsageDashboard provider="codex" status="ready" report={report} errorMessage={null} />)
    const card = screen.getAllByTestId('usage-card').find((element) => element.getAttribute('data-card-id') === 'rate_limit.primary_window')
    expect(card?.textContent).toContain('미확인')
    expect(card?.textContent).toContain('3시간 한도')
  })

  it('When json path ids are long then they wrap instead of forcing horizontal scroll', () => {
    render(<UsageDashboard provider="codex" status="ready" report={report} errorMessage={null} />)
    for (const code of screen.getAllByText(/rate_limit|mcp|code_review/)) {
      expect(code.className).toContain('break-all')
    }
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
