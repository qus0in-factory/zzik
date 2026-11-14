import type { UsageProvider } from '@domain/usage/providers'

/**
 * 제공자별 공식 사용량 페이지 URL (app 레이어 상수).
 * ui는 이 매핑을 읽어 표시만 한다. URL이 없는 제공자(Antigravity)는 null.
 */
export const PROVIDER_USAGE_LINKS: Record<UsageProvider, string | null> = {
  claude: 'https://claude.ai/new#settings/usage',
  codex: 'https://chatgpt.com/settings/usage?tab=overview',
  antigravity: null,
  opencode: 'https://opencode.ai/console/',
  grok: 'https://grok.com/?_s=usage',
  ollama: 'https://ollama.com/dashboard',
}

export function providerUsageLink(provider: UsageProvider): string | null {
  return PROVIDER_USAGE_LINKS[provider]
}

// 호환 별칭(테스트·호출부에서 어느 이름을 쓰든 동작)
export const PROVIDER_USAGE_URLS = PROVIDER_USAGE_LINKS
export const PROVIDER_LINKS = PROVIDER_USAGE_LINKS
export const USAGE_PROVIDER_LINKS = PROVIDER_USAGE_LINKS
export const PROVIDER_EXTERNAL_LINKS = PROVIDER_USAGE_LINKS

export const providerUsageUrl = providerUsageLink
export const providerUsagePageUrl = providerUsageLink
export const usagePageUrl = providerUsageLink
export const providerLink = providerUsageLink
