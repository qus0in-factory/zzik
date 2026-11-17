// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TrendPage } from '@ui/TrendPage'
import { TREND_LINKS } from '@ui/trend-links'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const EXPECTED = [
  { name: 'Artificial Analysis', domain: 'artificialanalysis.ai', description: '지능·속도·가격을 독립 벤치마크로 비교', href: 'https://artificialanalysis.ai/' },
  { name: 'Cognition Frontier Code', domain: 'cognition.com', description: '프론티어 코딩 모델의 실제 작업 성능 비교', href: 'https://cognition.com/frontiercode' },
  { name: 'Arena Leaderboard', domain: 'arena.ai', description: '사용자 투표 기반 모델 선호 순위', href: 'https://arena.ai/leaderboard' },
  { name: 'OpenRouter Rankings', domain: 'openrouter.ai', description: 'OpenRouter 사용량 기준 인기 모델 순위', href: 'https://openrouter.ai/rankings' },
  { name: 'OpenCode 데이터', domain: 'opencode.ai', description: 'OpenCode 사용량·모델 데이터', href: 'https://opencode.ai/ko/data' },
] as const

describe('Given the /trend external link list', () => {
  it('When TrendPage renders Then five links appear in order with href, target and rel, without data calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(
      <MemoryRouter initialEntries={['/trend']}>
        <TrendPage />
      </MemoryRouter>,
    )

    expect(screen.queryByText('트렌드 화면은 아직 준비 중입니다.')).toBeNull()
    expect(TREND_LINKS.map((link) => link.url)).toEqual(EXPECTED.map((item) => item.href))

    const list = screen.getByRole('list', { name: '트렌드 참고 링크' })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(links.map((link) => link.getAttribute('href'))).toEqual(EXPECTED.map((item) => item.href))

    for (const [index, link] of links.entries()) {
      const expected = EXPECTED[index]!
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.textContent).toContain(expected.name)
      expect(link.textContent).toContain(expected.domain)
      expect(link.textContent).toContain(expected.description)
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
