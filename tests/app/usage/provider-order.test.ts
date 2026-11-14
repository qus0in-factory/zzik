import { describe, expect, it } from 'vitest'
import { isDefaultOrder, moveProvider, normalizeOrder } from '@app/usage/provider-order'
import { USAGE_PROVIDERS } from '@domain/usage/providers'

const DEFAULT = USAGE_PROVIDERS

describe('Given the provider order normalization', () => {
  it('When nothing is saved or the value is not an array Then the default order', () => {
    expect(normalizeOrder(null, DEFAULT)).toEqual(DEFAULT)
    expect(normalizeOrder('claude', DEFAULT)).toEqual(DEFAULT)
    expect(normalizeOrder({}, DEFAULT)).toEqual(DEFAULT)
  })
  it('When a saved order lacks a new provider Then it is appended after the saved ones in default order', () => {
    expect(normalizeOrder(['grok', 'claude'], DEFAULT)).toEqual(['grok', 'claude', 'codex', 'antigravity', 'opencode', 'ollama'])
  })
  it('When a saved id no longer exists, is duplicated, or is not a string Then it is dropped', () => {
    expect(normalizeOrder(['gone', 'ollama', 'ollama', 7, null, 'claude'], DEFAULT)).toEqual(['ollama', 'claude', 'codex', 'antigravity', 'opencode', 'grok'])
  })
  it('When the saved order is complete Then it is kept as is', () => {
    const custom = ['ollama', 'grok', 'opencode', 'antigravity', 'codex', 'claude'] as const
    expect(normalizeOrder(custom, DEFAULT)).toEqual(custom)
  })
  it('Then normalize never returns the same array instance as the defaults (no shared mutation)', () => {
    expect(normalizeOrder(null, DEFAULT)).not.toBe(DEFAULT)
  })
})

describe('Given moving a provider', () => {
  it('When moved right Then it lands at the target index and the others shift left', () => {
    expect(moveProvider(['claude', 'codex', 'antigravity'] as const, 'claude', 2)).toEqual(['codex', 'antigravity', 'claude'])
  })
  it('When moved left Then the others shift right', () => {
    expect(moveProvider(['claude', 'codex', 'antigravity'] as const, 'antigravity', 0)).toEqual(['antigravity', 'claude', 'codex'])
  })
  it('When the index is out of range Then it is clamped; unknown id or same index returns the same order', () => {
    expect(moveProvider(['claude', 'codex'] as const, 'claude', 9)).toEqual(['codex', 'claude'])
    expect(moveProvider(['claude', 'codex'] as const, 'codex', -3)).toEqual(['codex', 'claude'])
    const order = ['claude', 'codex'] as const
    expect(moveProvider(order, 'claude', 0)).toBe(order)
    expect(moveProvider(order, 'nope' as never, 1)).toBe(order)
  })
  it('Then moving does not mutate the input', () => {
    const order = Object.freeze(['claude', 'codex', 'antigravity'] as const)
    expect(() => moveProvider(order, 'claude', 2)).not.toThrow()
  })
})

describe('Given the default-order check', () => {
  it('When the order equals the default Then isDefaultOrder is true', () => {
    expect(isDefaultOrder([...DEFAULT], DEFAULT)).toBe(true)
    expect(isDefaultOrder(['codex', 'claude', 'antigravity', 'opencode', 'grok', 'ollama'], DEFAULT)).toBe(false)
  })
})
