// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { TrendGateway } from '@domain/trend/gateway'
import type { TrendSection, TrendSectionPayload } from '@shared/trend-contract'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { TrendPage } from '@ui/TrendPage'
import { createDeferred } from '../../fakes/usage-ports'
import { createTestQueryClient } from '../../helpers/query'
import planFixture from '../../fixtures/trend/plan-models.payload.json'
import freeFixture from '../../fixtures/trend/free-models.payload.json'
import metricsFixture from '../../fixtures/trend/metrics.payload.json'
import newFixture from '../../fixtures/trend/new-models.payload.json'

const plan = planFixture as TrendSectionPayload
const free = freeFixture as TrendSectionPayload
const metrics = metricsFixture as TrendSectionPayload
const latest = newFixture as TrendSectionPayload

afterEach(cleanup)

function renderPage(fetchSection: TrendGateway['fetchSection']) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TrendGatewayProvider deps={{ gateway: { fetchSection }, enabled: true }}>
        <MemoryRouter initialEntries={['/trend']}>
          <TrendPage />
        </MemoryRouter>
      </TrendGatewayProvider>
    </QueryClientProvider>,
  )
}

const bySection: TrendGateway['fetchSection'] = async (section: TrendSection) => ({
  ok: true,
  value: section === 'plan-models' ? plan : section === 'free-models' ? free : section === 'metrics' ? metrics : latest,
})

describe('Given the plan-models section on /trend', () => {
  it('When data loads Then shows plan groups, matched metadata, confidence and notes', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '요금제 추가' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-plan-models'))
    expect(await section.findByText('DeepSeek V4.1 Flash 1017')).toBeTruthy()
    expect(section.getByRole('heading', { name: 'OpenCode Go' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Ollama Cloud' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Antigravity (Google AI Pro)' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Claude Max' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Grok' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'ChatGPT/Codex' })).toBeTruthy()
    expect(section.getByText('New Go Model')).toBeTruthy()
    expect(section.getByText('Claude Fable 5')).toBeTruthy()
    expect(section.getByText('anthropic')).toBeTruthy()
    expect(section.getAllByText('카탈로그')).toHaveLength(3)
    expect(section.getByText('부분')).toBeTruthy()
    expect(section.getAllByText('계정')).toHaveLength(1)
    expect(section.getByText('부분 판정')).toBeTruthy()
    expect(section.getByText('일부 모델은 표시명 또는 자격 기준으로만 확인되어 요금제 포함을 완전히 보장하지 않습니다.')).toBeTruthy()
    expect(section.getByText('Grok Build 자격 관측이며 SuperGrok 앱 포함 여부는 확인되지 않았습니다.')).toBeTruthy()
    expect(section.getByText('문서 기반 판정은 아직 제공하지 않습니다.')).toBeTruthy()
    expect(section.getAllByText('판정 불가')).toHaveLength(2)
    expect(section.getAllByText('출시일 미상')).toHaveLength(2)
    expect(section.getAllByTestId('trend-plan-item')).toHaveLength(5)
  })

  it('When the section is loading Then shows the loading state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<TrendGateway['fetchSection']>>>()
    renderPage(() => deferred.promise)
    expect(await screen.findByText('요금제 모델을 불러오는 중…')).toBeTruthy()
  })

  it('When the section fails Then shows an error with retry; not_ready is an empty state', async () => {
    renderPage(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    const section = within(screen.getByTestId('trend-plan-models'))
    const alert = await section.findByRole('alert')
    expect(alert.textContent).toContain('요금제 모델을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPage(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    expect(await screen.findByText('최근 14일 안에 새로 관측된 모델이 없습니다.')).toBeTruthy()
    expect(within(screen.getByTestId('trend-plan-models')).queryByRole('alert')).toBeNull()
  })

  it('When the payload has no plans Then shows the empty state', async () => {
    renderPage(async () => ({ ok: true, value: { ...plan, plans: [] } }))
    expect(await screen.findByText('최근 14일 안에 새로 관측된 모델이 없습니다.')).toBeTruthy()
  })

  it('When /trend renders Then the plan section is first and the order is unchanged', async () => {
    renderPage(bySection)
    await screen.findByText('DeepSeek V4.1 Flash 1017')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['요금제 추가', '최근 7일 새 모델', '무료로 쓸 수 있는 모델', '성능 지표', '참고 링크'])
  })
})
