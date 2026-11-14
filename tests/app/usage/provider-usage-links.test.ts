import { describe, expect, it } from 'vitest'
import { providerUsageLink, PROVIDER_USAGE_LINKS } from '@app/usage/provider-usage-links'

describe('Given provider usage links', () => {
  it('When looking up claude Then returns its official usage page', () => {
    expect(providerUsageLink('claude')).toBe('https://claude.ai/new#settings/usage')
  })
  it('When looking up codex Then returns ChatGPT usage page', () => {
    expect(providerUsageLink('codex')).toBe('https://chatgpt.com/settings/usage?tab=overview')
  })
  it('When looking up ollama Then returns ollama dashboard', () => {
    expect(providerUsageLink('ollama')).toBe('https://ollama.com/dashboard')
  })
  it('When looking up grok Then returns grok usage page', () => {
    expect(providerUsageLink('grok')).toBe('https://grok.com/?_s=usage')
  })
  it('When looking up opencode Then returns opencode console', () => {
    expect(providerUsageLink('opencode')).toBe('https://opencode.ai/console/')
  })
  it('When looking up antigravity Then returns null', () => {
    expect(providerUsageLink('antigravity')).toBeNull()
    expect(PROVIDER_USAGE_LINKS.antigravity).toBeNull()
  })
})
