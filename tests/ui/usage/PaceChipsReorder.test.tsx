// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '@ui/App'
import { PaceChips } from '@ui/usage/PaceChips'
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** jsdom에는 레이아웃이 없어 칩 폭·위치를 흉내 낸다: 칩 i는 left = i × 110, 폭 100. */
function stubChipLayout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const list = this.closest('ul')
    const index = list === null || this.dataset.chipId === undefined ? 0 : [...list.querySelectorAll('[data-chip-id]')].indexOf(this)
    const left = index * 110
    return { left, right: left + 100, top: 0, bottom: 30, width: 100, height: 30, x: left, y: 0, toJSON: () => ({}) } as DOMRect
  })
}
const press = (chip: HTMLElement, init: Record<string, unknown>) => fireEvent.pointerDown(chip, { button: 0, isPrimary: true, pointerId: 1, ...init })
const moveTo = (init: Record<string, unknown>) => fireEvent.pointerMove(window, { pointerId: 1, ...init })
const release = (init: Record<string, unknown> = {}) => fireEvent.pointerUp(window, { pointerId: 1, ...init })


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

describe('Given pointer edge cases (검수 FIX)', () => {
  it('When a touch press moves only vertically before the long-press fires Then the drag is cancelled and the click is not swallowed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    press(claude, { pointerType: 'touch', clientX: 50, clientY: 10 })
    moveTo({ pointerType: 'touch', clientX: 50, clientY: 40 }) // 세로로 30px: 스크롤로 본다
    await act(async () => { vi.advanceTimersByTime(500) })
    expect(claude.closest('li')?.getAttribute('data-grabbed')).toBe('false')
    release()
    const notPrevented = fireEvent.click(claude)
    expect(notPrevented).toBe(true)
  })
  it('When a touch press stays still past the long-press time Then the drag starts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    press(claude, { pointerType: 'touch', clientX: 50, clientY: 10 })
    moveTo({ pointerType: 'touch', clientX: 52, clientY: 12 }) // 8px 이내 흔들림은 허용
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(claude.closest('li')?.getAttribute('data-grabbed')).toBe('true')
    release()
  })
  it('When a mouse drag crosses the threshold and far enough in ONE pointermove Then the drop already reorders (같은 이벤트로 목표 계산)', async () => {
    const app = renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    press(claude, { pointerType: 'mouse', clientX: 50, clientY: 10 })
    moveTo({ pointerType: 'mouse', clientX: 50 + 230, clientY: 10 }) // 칩 두 개 건너편
    release({ clientX: 280 })
    expect(chipOrder().slice(0, 3)).toEqual(['codex', 'antigravity', 'claude'])
    expect(app.stored).toEqual(app.store.getState().order)
  })
  it('When the pointer is released without crossing the threshold Then nothing moves and the click goes through', async () => {
    renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    press(claude, { pointerType: 'mouse', clientX: 50, clientY: 10 })
    moveTo({ pointerType: 'mouse', clientX: 52, clientY: 10 })
    release()
    expect(chipOrder()[0]).toBe('claude')
    expect(fireEvent.click(claude)).toBe(true)
  })
  it('When the component unmounts during a press or drag Then window listeners are removed and no late timer fires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const added: string[] = []
    const removed: string[] = []
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const app = renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    press(claude, { pointerType: 'touch', clientX: 50, clientY: 10 })
    for (const call of add.mock.calls) if (['pointermove', 'pointerup', 'pointercancel'].includes(call[0] as string)) added.push(call[0] as string)
    cleanup()
    for (const call of remove.mock.calls) if (['pointermove', 'pointerup', 'pointercancel'].includes(call[0] as string)) removed.push(call[0] as string)
    expect(added.sort()).toEqual(['pointercancel', 'pointermove', 'pointerup'])
    expect(removed.sort()).toEqual(added)
    await act(async () => { vi.advanceTimersByTime(1000) }) // 길게 누르기 타이머가 남아 있었다면 여기서 터진다
    expect(app.store.getState().order[0]).toBe('claude')
  })
  it('When a drag ends Then the pointer capture is released', async () => {
    renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    const capture = vi.fn()
    const release_ = vi.fn()
    Object.assign(claude, { setPointerCapture: capture, releasePointerCapture: release_, hasPointerCapture: () => true })
    press(claude, { pointerType: 'mouse', clientX: 50, clientY: 10 })
    moveTo({ pointerType: 'mouse', clientX: 70, clientY: 10 })
    expect(capture).toHaveBeenCalledWith(1)
    release()
    expect(release_).toHaveBeenCalledWith(1)
  })
  it('When the long-press context menu fires on a pending touch or a drag Then it is prevented; a normal right click is not', async () => {
    renderApp()
    await ready()
    stubChipLayout()
    const claude = screen.getByTestId('usage-pace-claude')
    expect(fireEvent.contextMenu(claude)).toBe(true)
    press(claude, { pointerType: 'touch', clientX: 50, clientY: 10 })
    expect(fireEvent.contextMenu(claude)).toBe(false)
    release()
  })
})

describe('Given keyboard blur and reset (검수 FIX)', () => {
  it('When a keyboard grab loses focus Then the cancel is announced', async () => {
    renderApp()
    await ready()
    const claude = screen.getByTestId('usage-pace-claude')
    claude.focus()
    fireEvent.keyDown(claude, { key: ' ' })
    fireEvent.keyDown(claude, { key: 'ArrowRight' })
    fireEvent.blur(claude)
    expect(live()).toContain('취소')
    expect(chipOrder()[0]).toBe('claude')
  })
  it('When the order is reset Then the section FLIP is armed first (onBeforeMove)', async () => {
    const store = createProviderOrderStore({ load: () => ['ollama', 'claude'], save: () => {}, clear: () => {} })
    const gateway = createFakeUsageGateway()
    const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    const before = vi.fn()
    render(
      <providers.wrapper>
        <ProviderOrderProvider store={store}>
          <PaceChips onBeforeMove={before} />
        </ProviderOrderProvider>
      </providers.wrapper>,
    )
    fireEvent.click(screen.getByRole('button', { name: '제공자 순서 초기화' }))
    expect(before).toHaveBeenCalledTimes(1)
    expect(store.getState().customized).toBe(false)
  })
})

