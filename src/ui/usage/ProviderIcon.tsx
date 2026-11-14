import type { ReactNode } from 'react'
import { siClaude, siOllama, siOpencode } from 'simple-icons'
import { Orbit, Sparkles, Terminal } from 'lucide-react'
import type { UsageProvider } from '@domain/usage/providers'

/**
 * 제공자 아이콘(섹션 제목·페이스 칩 공용). 색은 currentColor라 라이트·다크에서 모두 보인다.
 * 출처: Claude·Ollama·OpenCode는 simple-icons(CC0-1.0, 상표권은 각 소유자). simple-icons에 없는
 * ChatGPT(Codex)·Antigravity·Grok은 공식 로고의 라이선스가 명확하지 않아 lucide-react(ISC) 대체 아이콘을 쓴다.
 * 자세한 내용은 docs/design/fonts-and-icons.md.
 */
const SIMPLE_ICON_PATHS: Partial<Record<UsageProvider, string>> = {
  claude: siClaude.path,
  ollama: siOllama.path,
  opencode: siOpencode.path,
}
const FALLBACK_ICONS = { codex: Terminal, antigravity: Orbit, grok: Sparkles } as const

export interface ProviderIconProps {
  provider: UsageProvider
  /** 제공자 이름. 주면 아이콘이 이름을 알리고(role=img), 생략하면 옆 텍스트가 이름이라 장식(aria-hidden)이다. */
  label?: string
  className?: string
}

export function ProviderIcon({ provider, label, className = 'size-5' }: ProviderIconProps): ReactNode {
  const a11y = label === undefined ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label }
  const title = label === undefined ? undefined : <title>{label}</title>
  const path = SIMPLE_ICON_PATHS[provider]
  if (path !== undefined) {
    return (
      <svg data-testid={`provider-icon-${provider}`} viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`} {...a11y}>
        {title}
        <path d={path} />
      </svg>
    )
  }
  const Fallback = FALLBACK_ICONS[provider as keyof typeof FALLBACK_ICONS]
  return (
    <span data-testid={`provider-icon-${provider}`} className="inline-flex shrink-0" {...a11y}>
      <Fallback aria-hidden="true" className={className} />
    </span>
  )
}
