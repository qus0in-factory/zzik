// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '@ui/App'
import agyRaw from '../fixtures/antigravity-usage.normal.json'
import grokRaw from '../fixtures/grok-usage.normal.json'
import ollamaRaw from '../fixtures/ollama-usage.normal.json'
import opencodeRaw from '../fixtures/opencode-usage.normal.json'
import normalRaw from '../fixtures/claude-usage.normal.json'
import codexUnknownRaw from '../fixtures/codex-usage.unknown-keys.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../fakes/usage-ports'
import { makeUsageProviders, createTestQueryClient } from '../helpers/query'

afterEach(cleanup)

function renderApp(client = createTestQueryClient()) {
  const gateway = createFakeUsageGateway()
  gateway.pushResultFor('claude', { ok: true, usage: normalRaw, collection: null, rawText: null })
  gateway.pushResultFor('codex', { ok: true, usage: codexUnknownRaw, collection: null, rawText: null })
  gateway.pushResultFor('antigravity', { ok: true, usage: agyRaw, collection: null, rawText: null })
  gateway.pushResultFor('opencode', { ok: true, usage: opencodeRaw, collection: null, rawText: null })
  gateway.pushResultFor('grok', { ok: true, usage: grokRaw, collection: null, rawText: null })
  gateway.pushResultFor('ollama', { ok: true, usage: ollamaRaw, collection: null, rawText: null })
  const providers = makeUsageProviders(
    {
      gateway,
      clock: createFakeUsageClock(),
      scheduler: createFakeUsageScheduler(),
    },
    client,
  )
  const utils = render(
    <providers.wrapper>
      <App />
    </providers.wrapper>,
  )
  return { utils, gateway }
}

describe('Given the dashboard with six providers', () => {
  it('When it renders Then the header h1 is the dashboard title with the gerbil logo, and no filler copy remains', () => {
    renderApp()
    const heading = screen.getByRole('heading', { name: 'Zzik : AI 사용량 대시보드', level: 1 })
    expect(heading.closest('header')).not.toBeNull()
    // 제목 텍스트와 중복되는 장식 이미지라 alt는 비워 스크린리더가 제목만 읽게 한다
    const logo = heading.querySelector('img')
    expect(logo?.getAttribute('src')).toBe('/icon-192.png')
    expect(logo?.getAttribute('alt')).toBe('')
    for (const filler of ['Hello Young-In', '구독 사용량을 한눈에 확인하는 공간입니다.', '개인 대시보드']) {
      expect(screen.queryByText(filler)).toBeNull()
    }
  })

  it('When the data arrives Then pace chips show used / expected for the longest-cycle window and skip providers without one', async () => {
    renderApp()
    const chips = await screen.findAllByTestId(/^usage-pace-/)
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) expect(chip.textContent).toMatch(/·(월|주) \d+% \/ \d+%$/)
    expect(chips.every((chip) => ['true', 'false'].includes(chip.getAttribute('data-over-pace') ?? ''))).toBe(true)
  })

  it('When both queries resolve Then six provider sections render side by side in fixed order', async () => {
    renderApp()
    await screen.findByTestId('usage-section-claude')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ChatGPT (Codex)', level: 2 })).toBeTruthy())
    const sections = screen.getAllByTestId(/^usage-section-/)
    expect(sections.map((section) => section.getAttribute('data-provider'))).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
    expect(screen.getByRole('heading', { name: 'Claude', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'ChatGPT (Codex)', level: 2 })).toBeTruthy()
  })

  it('When the data arrives Then each section shows its own values from its own query', async () => {
    renderApp()
    await screen.findByText('37%')
    await screen.findByText('55%')
    expect(screen.getByText('모델·기능별 한도')).toBeTruthy()
    expect(screen.getByText('추가 한도')).toBeTruthy()
    // codex의 추가 버킷은 rate_limit 밖의 창에서 나온다(D6).
    expect(screen.getByText('Code Review Rate Limit · 1시간 한도')).toBeTruthy()
  })

  it('When the summary renders Then both provider chips link to their sections (D8)', async () => {
    renderApp()
    const claudeChip = await screen.findByTestId('usage-summary-claude')
    const codexChip = screen.getByTestId('usage-summary-codex')
    expect(screen.getByTestId('usage-summary-antigravity').getAttribute('href')).toBe('#usage-antigravity')
    expect(claudeChip.getAttribute('href')).toBe('#usage-claude')
    expect(codexChip.getAttribute('href')).toBe('#usage-codex')
    expect(claudeChip.textContent).toContain('Claude')
    expect(codexChip.textContent).toContain('ChatGPT (Codex)')
  })

  it('When one provider fails Then the other section still shows its cards (D8 격리)', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResultFor('claude', { ok: true, usage: normalRaw, collection: null, rawText: null })
    gateway.pushResultFor('codex', { ok: false, reason: 'api_error', message: 'storage_unavailable' })
    const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    render(
      <providers.wrapper>
        <App />
      </providers.wrapper>,
    )
    await screen.findByText('37%')
    const codexSection = await screen.findByTestId('usage-section-codex')
    expect(codexSection.textContent).toContain('읽지 못했습니다')
    expect(screen.getByText('37%')).toBeTruthy()
    expect(screen.getByTestId('usage-summary-codex').textContent).toContain('오류')
  })
})
