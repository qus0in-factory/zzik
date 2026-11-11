// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { createUsageUiStore, useFixtureChoice, useRawJsonOpen, useUsageUiStore } from '@app/usage/usage-ui-store'
import {
  usageStatusLabel,
} from '@ui/usage/status-label'
import type { UsageReport } from '@domain/usage/types'

afterEach(cleanup)

function report(status: UsageReport['status']): UsageReport {
  return { status, windows: [], metrics: [], others: [], issues: [], raw: null }
}

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

  it('When raw JSON is toggled per provider then each provider keeps its own open state (D8)', () => {
    const { result } = renderHook(() => ({ claude: useRawJsonOpen('claude'), codex: useRawJsonOpen('codex') }))
    expect(result.current.claude.open).toBe(false)
    expect(result.current.codex.open).toBe(false)

    act(() => {
      result.current.claude.toggle()
    })
    expect(result.current.claude.open).toBe(true)
    expect(result.current.codex.open).toBe(false)

    act(() => {
      result.current.codex.setOpen(true)
    })
    expect(result.current.codex.open).toBe(true)
    expect(result.current.claude.open).toBe(true)

    act(() => {
      result.current.claude.toggle()
    })
    expect(result.current.claude.open).toBe(false)
    expect(result.current.codex.open).toBe(true)
  })

  it('When a store is created then both providers start collapsed and independently mutable', () => {
    const store = createUsageUiStore('/')
    expect(store.getState().rawJsonOpen).toEqual({ claude: false, codex: false })
    store.getState().toggleRawJson('codex')
    expect(store.getState().rawJsonOpen).toEqual({ claude: false, codex: true })
  })
})

describe('Given the status label mapping used by summary chips', () => {
  it.each([
    ['loading', null, '불러오는 중'],
    ['error', null, '오류'],
    ['ready', report('normal'), '정상'],
    ['ready', report('warn'), '주의'],
    ['ready', report('limit'), '한도 도달'],
    ['ready', report('unknown'), '데이터 없음'],
    ['stale', report('normal'), '오래된 데이터'],
  ] as const)('When the state is %s then the chip label is %s', (status, value, expected) => {
    expect(usageStatusLabel(status, value)).toBe(expected)
  })

  it('When a ready state has no report then it reads as no data', () => {
    expect(usageStatusLabel('ready', null)).toBe('데이터 없음')
  })
})
