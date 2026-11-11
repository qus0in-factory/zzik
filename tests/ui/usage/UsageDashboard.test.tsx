// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

describe('Given the usage dashboard with the unknown keys report', () => {
  it('When rendering then every top level key of the raw response gets a card (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getAllByTestId('usage-card')).toHaveLength(9)
    expect(screen.getByText('주간 · Fable')).toBeTruthy()
    expect(screen.getByText('주간 · Haiku')).toBeTruthy()
    expect(screen.getAllByText('thirty_day').length).toBeGreaterThanOrEqual(1)
  })

  it('When rendering a null valued card then it shows no value instead of 0% (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const coworkLabel = screen.getByText('Cowork 주간')
    const card = coworkLabel.closest('[data-testid="usage-card"]') as HTMLElement
    expect(card.textContent).toContain('정보 없음')
    expect(card.textContent).not.toContain('0%')
  })

  it('When rendering unknown metric cards then they carry the unverified badge and known ones do not (U2)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const fableLabel = screen.getByText('주간 · Fable')
    const fableCard = fableLabel.closest('[data-testid="usage-card"]') as HTMLElement
    expect(fableCard.textContent).toContain('미확인')
    const opusCard = (screen.getByText('Opus 주간').closest('[data-testid="usage-card"]') as HTMLElement)
    expect(opusCard.textContent).not.toContain('미확인')
  })

  it('When rendering then the grids stay single column at 320px (U8)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    for (const grid of screen.getAllByTestId('usage-grid')) {
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
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getByLabelText('사용량')).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(9)
  })

  it('When a report is ready then all raw keys are rendered on screen (완전성 불변식)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<UsageDashboard status="ready" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    const renderedText = document.body.textContent ?? ''
    for (const key of Object.keys(report.raw ?? {})) {
      expect(renderedText).toContain(key)
    }
  })
})

describe('Given the loading state', () => {
  it('When no data has arrived yet then skeletons render without value text (U4)', () => {
    render(<UsageDashboard status="loading" report={null} errorMessage={null} />)
    const busy = screen.getByTestId('usage-section')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('[data-testid="usage-skeleton"]').length).toBe(3)
    expect(screen.queryByText('37%')).toBeNull()
    expect(screen.queryByText('정보 없음')).toBeNull()
  })
})

describe('Given the error state', () => {
  it('When loading fails then the message and a retry button show up (U5)', () => {
    const onRetry = vi.fn()
    render(<UsageDashboard status="error" report={null} errorMessage="사용량을 불러오지 못했습니다" onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain('사용량을 불러오지 못했습니다')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('When a retry keeps an old report then cards still show with the error (U5)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<UsageDashboard status="error" report={report} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage="사용량을 불러오지 못했습니다" />)
    expect(screen.getByRole('alert').textContent).toContain('사용량을 불러오지 못했습니다')
    expect(screen.getAllByTestId('usage-card')).toHaveLength(5)
  })
})

describe('Given the stale state', () => {
  it('When the last load is old then the stale badge, the age and the kept cards show up (U6)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(
      <UsageDashboard
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
    render(<UsageDashboard status="ready" report={{ status: 'unknown', windows: [], metrics: [], others: [], issues: [], raw: {} }} lastSuccessText="마지막 수집 11:58 (2분 전)" errorMessage={null} />)
    expect(screen.getByText('표시할 사용량이 없습니다')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
