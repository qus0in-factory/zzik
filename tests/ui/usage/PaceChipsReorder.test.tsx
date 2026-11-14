// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '@ui/App'
import { ProviderOrderProvider } from '@app/usage/ProviderOrderContext'
import { createProviderOrderStore } from '@app/usage/provider-order-store'
import type { ProviderOrderPort } from '@app/usage/provider-order'
import agyRaw from '../../fixtures/antigravity-usage.gemini-argon.json'
import grokRaw from '../../fixtures/grok-usage.normal.json'
import ollamaRaw from '../../fixtures/ollama-usage.normal.json'
import opencodeRaw from '../../fixtures/opencode-usage.normal.json'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import codexRaw from '../../fixtures/codex-usage.normal.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { makeUsageProviders } from '../../helpers/query'

afterEach(cleanup)

function renderApp(saved: unknown[] | null = null) {
  const gateway = createFakeUsageGateway()
  for (const [provider, usage] of [['claude', normalRaw], ['codex', codexRaw], ['antigravity', agyRaw], ['opencode', opencodeRaw], ['grok', grokRaw], ['ollama', ollamaRaw]] as const) {
    gateway.pushResultFor(provider, { ok: true, usage, collection: null, rawText: null })
  }
  let stored: unknown[] | null = saved
  const port: ProviderOrderPort = { load: () => stored, save: (order) => { stored = [...order] }, clear: () => { stored = null } }
  const store = createProviderOrderStore(port)
  const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
  render(
    <providers.wrapper>
      <ProviderOrderProvider store={store}>
        <App />
      </ProviderOrderProvider>
    </providers.wrapper>,
  )
  return { store, get stored() { return stored } }
}

const sectionOrder = () => screen.getAllByTestId(/^usage-section-/).map((section) => section.getAttribute('data-provider'))
const chipOrder = () => screen.getAllByTestId(/^usage-pace-(?!skeleton)/).map((chip) => chip.getAttribute('data-testid')?.replace('usage-pace-', ''))
const live = () => document.querySelector('nav [aria-live="assertive"]')?.textContent ?? ''

async function ready() {
  await waitFor(() => expect(screen.queryByTestId('usage-pace-skeleton')).toBeNull())
  await screen.findByTestId('usage-pace-claude')
}

describe('Given the draggable pace chips (순서 = 패널 순서)', () => {
  it('When a stored order exists Then chips and sections both follow it, and the skeleton sections too', async () => {
    renderApp(['ollama', 'grok'])
    expect(sectionOrder()).toEqual(['ollama', 'grok', 'claude', 'codex', 'antigravity', 'opencode'])
    await ready()
    expect(chipOrder()).toEqual(['ollama', 'grok', 'claude', 'codex', 'antigravity', 'opencode'])
  })

  it('When a chip is grabbed with Space, moved with arrows and dropped Then chips and panels reorder together and the order is saved', async () => {
    const app = renderApp()
    await ready()
    const claude = screen.getByTestId('usage-pace-claude')
    claude.focus()
    fireEvent.keyDown(claude, { key: ' ' })
    expect(live()).toContain('Claude 칩을 잡았습니다')
    fireEvent.keyDown(claude, { key: 'ArrowRight' })
    fireEvent.keyDown(claude, { key: 'ArrowRight' })
    expect(live()).toContain('3번째로 이동')
    // 놓기 전에는 DOM 순서가 그대로다(끄는 동안 노드를 옮기지 않는다)
    expect(chipOrder()[0]).toBe('claude')
    fireEvent.keyDown(claude, { key: 'Enter' })
    expect(chipOrder().slice(0, 3)).toEqual(['codex', 'antigravity', 'claude'])
    expect(sectionOrder().slice(0, 3)).toEqual(['codex', 'antigravity', 'claude'])
    expect(live()).toContain('3번째에 놓았습니다')
    expect(app.stored).toEqual(app.store.getState().order)
    // 놓은 뒤에도 같은 칩에 포커스가 남는다
    expect(document.activeElement).toBe(screen.getByTestId('usage-pace-claude'))
  })

  it('When Esc is pressed while grabbed Then nothing changes', async () => {
    renderApp()
    await ready()
    const claude = screen.getByTestId('usage-pace-claude')
    fireEvent.keyDown(claude, { key: ' ' })
    fireEvent.keyDown(claude, { key: 'ArrowRight' })
    fireEvent.keyDown(claude, { key: 'Escape' })
    expect(live()).toContain('취소')
    expect(chipOrder()[0]).toBe('claude')
    expect(sectionOrder()[0]).toBe('claude')
  })

  it('When Enter is pressed on a chip that is not grabbed Then the normal link behaviour is left alone', async () => {
    renderApp()
    await ready()
    const claude = screen.getByTestId('usage-pace-claude')
    const prevented = !fireEvent.keyDown(claude, { key: 'Enter' })
    expect(prevented).toBe(false)
  })

  it('When the first chip is moved left or the last right Then it stays (clamped)', async () => {
    renderApp()
    await ready()
    const claude = screen.getByTestId('usage-pace-claude')
    fireEvent.keyDown(claude, { key: ' ' })
    fireEvent.keyDown(claude, { key: 'ArrowLeft' })
    expect(live()).toContain('1번째로 이동')
    fireEvent.keyDown(claude, { key: 'Enter' })
    expect(chipOrder()[0]).toBe('claude')
  })

  it('When the reset button is used Then the default order returns, the saved value is cleared and the button disables', async () => {
    const app = renderApp(['ollama', 'claude'])
    await ready()
    const reset = screen.getByRole('button', { name: '제공자 순서 초기화' }) as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    act(() => fireEvent.click(reset))
    expect(sectionOrder()).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
    expect(app.stored).toBeNull()
    expect((screen.getByRole('button', { name: '제공자 순서 초기화' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Then the chip row stays horizontally scrollable and touch dragging needs a long press (no scroll conflict)', async () => {
    renderApp()
    await ready()
    const list = screen.getByTestId('usage-pace-claude').closest('ul') as HTMLElement
    expect(list.className).toContain('overflow-x-auto')
    expect(list.className).not.toContain('touch-none')
  })

  it('When the entrance animation of a moved node ended Then data-entered keeps it from replaying', async () => {
    renderApp()
    await ready()
    const card = screen.getAllByTestId('usage-card')[0]
    fireEvent.animationEnd(card)
    expect(card.hasAttribute('data-entered')).toBe(true)
  })
})
