// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_VIEW_MODE, normalizeViewMode } from '@app/usage/view-mode'
import type { ViewModePort } from '@app/usage/view-mode'
import { createViewModeStore } from '@app/usage/view-mode-store'
import { useViewMode, ViewModeProvider } from '@app/usage/ViewModeContext'

afterEach(cleanup)

const fakePort = (initial: unknown = null) => {
  let saved: unknown = initial
  const calls = { save: 0 }
  const port: ViewModePort = { load: () => saved, save: (mode) => { saved = mode; calls.save += 1 } }
  return { port, calls, get saved() { return saved } }
}

describe('Given the view mode normalization (순수 함수)', () => {
  it('Then grid is the default and only grid|list are accepted', () => {
    expect(DEFAULT_VIEW_MODE).toBe('grid')
    expect(normalizeViewMode('list')).toBe('list')
    expect(normalizeViewMode('grid')).toBe('grid')
    for (const bad of [null, undefined, '', 'table', 'LIST', 3, {}, []]) expect(normalizeViewMode(bad)).toBe('grid')
  })
})

describe('Given the view mode zustand store (포트 주입)', () => {
  it('When nothing is stored Then grid; a stored list is restored; garbage falls back to grid', () => {
    expect(createViewModeStore(fakePort().port).getState().mode).toBe('grid')
    expect(createViewModeStore(fakePort('list').port).getState().mode).toBe('list')
    expect(createViewModeStore(fakePort('nonsense').port).getState().mode).toBe('grid')
    expect(createViewModeStore(null).getState().mode).toBe('grid')
  })
  it('When the mode changes Then it is saved once; setting the same mode saves nothing', () => {
    const fake = fakePort()
    const store = createViewModeStore(fake.port)
    store.getState().setMode('list')
    expect(store.getState().mode).toBe('list')
    expect(fake.saved).toBe('list')
    store.getState().setMode('list')
    expect(fake.calls.save).toBe(1)
  })
  it('When an invalid value is set Then it is normalized to grid', () => {
    const store = createViewModeStore(null)
    store.getState().setMode('weird' as never)
    expect(store.getState().mode).toBe('grid')
  })
})

describe('Given the hook', () => {
  it('When used inside a provider Then it reads and updates the store; outside it defaults to grid', () => {
    const store = createViewModeStore(null)
    const wrapper = ({ children }: { children: ReactNode }) => <ViewModeProvider store={store}>{children}</ViewModeProvider>
    const { result } = renderHook(() => useViewMode(), { wrapper })
    expect(result.current.mode).toBe('grid')
    act(() => result.current.setMode('list'))
    expect(result.current.mode).toBe('list')
    expect(renderHook(() => useViewMode()).result.current.mode).toBe('grid')
  })
})
