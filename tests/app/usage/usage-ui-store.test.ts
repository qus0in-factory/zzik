// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { createUsageUiStore, useFixtureChoice, useUsageUiStore } from '@app/usage/usage-ui-store'

afterEach(cleanup)

describe('Given the usage UI client store', () => {
  it('When a store is created with ?fixture=warn then the fixture choice starts there (A5 초기값)', () => {
    const store = createUsageUiStore('?fixture=warn')
    expect(store.getState().fixtureName).toBe('warn')
  })

  it('When a store is created without a fixture param then the choice starts at normal (A5 초기값)', () => {
    const store = createUsageUiStore('?other=1')
    expect(store.getState().fixtureName).toBe('normal')
  })

  it('When no search is given then the current location is parsed (A5 초기값, 브라우저 부팅 경로)', () => {
    window.history.replaceState(null, '', '?fixture=limited')
    const store = createUsageUiStore()
    expect(store.getState().fixtureName).toBe('limited')
  })

  it('When the fixture choice changes then the store holds the new name (A5: 게이트웨이 getter의 근원)', () => {
    const { result } = renderHook(() => useFixtureChoice())
    act(() => {
      result.current.setFixtureName('limited')
    })
    expect(useUsageUiStore.getState().fixtureName).toBe('limited')
  })


})
