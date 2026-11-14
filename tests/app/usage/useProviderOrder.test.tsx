// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ProviderOrderProvider, useProviderOrder } from '@app/usage/ProviderOrderContext'
import { createProviderOrderStore } from '@app/usage/provider-order-store'
import type { ProviderOrderPort } from '@app/usage/provider-order'
import { USAGE_PROVIDERS } from '@domain/usage/providers'

afterEach(cleanup)

function fakePort(initial: unknown[] | null = null) {
  let saved: unknown[] | null = initial
  const calls = { save: 0, clear: 0 }
  const port: ProviderOrderPort = {
    load: () => saved,
    save: (order) => { saved = [...order]; calls.save += 1 },
    clear: () => { saved = null; calls.clear += 1 },
  }
  return { port, calls, get saved() { return saved } }
}
const wrapperFor = (port: ProviderOrderPort | null) => {
  const store = createProviderOrderStore(port)
  return ({ children }: { children: ReactNode }) => <ProviderOrderProvider store={store}>{children}</ProviderOrderProvider>
}

describe('Given the provider order zustand store (순수 함수 호출 + 주입된 저장 포트)', () => {
  it('When nothing is stored Then the default order and not customized', () => {
    const { result } = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(fakePort().port) })
    expect(result.current.order).toEqual(USAGE_PROVIDERS)
    expect(result.current.customized).toBe(false)
  })
  it('When a stored order has a removed id and misses a provider Then it is normalized on load', () => {
    const { result } = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(fakePort(['gone', 'grok', 'claude']).port) })
    expect(result.current.order).toEqual(['grok', 'claude', 'codex', 'antigravity', 'opencode', 'ollama'])
    expect(result.current.customized).toBe(true)
  })
  it('When a provider is moved Then the order changes and is saved through the port', () => {
    const fake = fakePort()
    const { result } = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(fake.port) })
    act(() => result.current.move('ollama', 0))
    expect(result.current.order[0]).toBe('ollama')
    expect(fake.saved).toEqual(result.current.order)
    expect(result.current.customized).toBe(true)
  })
  it('When moved to the same place Then nothing is saved', () => {
    const fake = fakePort()
    const { result } = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(fake.port) })
    act(() => result.current.move('claude', 0))
    expect(fake.calls.save).toBe(0)
  })
  it('When reset Then the default order returns and the stored value is cleared', () => {
    const fake = fakePort(['ollama', 'claude'])
    const { result } = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(fake.port) })
    act(() => result.current.reset())
    expect(result.current.order).toEqual(USAGE_PROVIDERS)
    expect(fake.saved).toBeNull()
    expect(result.current.customized).toBe(false)
  })
  it('When there is no provider or no port (tests, static render) Then the default order and moves work without saving', () => {
    const bare = renderHook(() => useProviderOrder())
    expect(bare.result.current.order).toEqual(USAGE_PROVIDERS)
    const portless = renderHook(() => useProviderOrder(), { wrapper: wrapperFor(null) })
    act(() => portless.result.current.move('ollama', 0))
    expect(portless.result.current.order[0]).toBe('ollama')
  })
})
