import type { ReactNode } from 'react'
import { providerMetaFor, usageProviderIds } from '@app/usage/provider-meta'
import { useUsage } from '@app/usage/useUsage'
import { usageStatusLabel } from './status-label'

/**
 * 요약 칩 줄(ADR 0.3 D8): 제공자마다 칩 하나(`Claude · 정상`).
 * 칩은 해당 섹션으로 가는 앵커 링크이고, 같은 Query 키를 구독하므로 요청이 늘지 않는다.
 * 320px에서는 flex-wrap으로 줄바꿈한다.
 */
export function UsageSummary(): ReactNode {
  // 제공자는 정적 목록이라 훅 호출 수가 고정된다(동적 루프 아님).
  const providers = usageProviderIds()
  const claude = useUsage(providers[0])
  const codex = useUsage(providers[1])
  const states = { claude: claude.state, codex: codex.state } as const

  return (
    <nav aria-label="제공자 요약" className="mt-4">
      <ul className="flex flex-wrap items-center gap-2">
        {providers.map((provider) => {
          const meta = providerMetaFor(provider)
          const state = states[provider]
          return (
            <li key={provider} className="min-w-0">
              <a
                href={`#${meta.sectionId}`}
                data-testid={`usage-summary-${provider}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium hover:bg-accent"
              >
                <span className="truncate">{meta.title}</span>
                <span aria-hidden="true">·</span>
                <span className="text-muted-foreground">{usageStatusLabel(state.status, state.report)}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
