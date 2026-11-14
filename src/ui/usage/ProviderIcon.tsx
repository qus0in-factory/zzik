import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import { PROVIDER_ICON_PATHS } from './provider-icon-paths'

/**
 * 제공자 실제 로고(섹션 제목·페이스 칩 공용). 단색 currentColor라 라이트·다크에서 모두 보인다.
 * 출처·라이선스: provider-icon-paths.ts와 docs/design/fonts-and-icons.md.
 */
export interface ProviderIconProps {
  provider: UsageProvider
  /** 제공자 이름. 주면 아이콘이 이름을 알리고(role=img), 생략하면 옆 텍스트가 이름이라 장식(aria-hidden)이다. */
  label?: string
  className?: string
}

export function ProviderIcon({ provider, label, className = 'size-5' }: ProviderIconProps): ReactNode {
  const a11y = label === undefined ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label }
  return (
    <svg data-testid={`provider-icon-${provider}`} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={`shrink-0 ${className}`} {...a11y}>
      {label !== undefined && <title>{label}</title>}
      {PROVIDER_ICON_PATHS[provider].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
