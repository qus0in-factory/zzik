import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import { providerMetaFor, usageProviderIds } from '@app/usage/provider-meta'
import { useUsage } from '@app/usage/useUsage'
import { usageStatusLabel } from './status-label'

/**
 * 요약 칩 줄(ADR 0.3 D8): 제공자마다 칩 하나(`Claude · 정상`).
 * 칩은 해당 섹션으로 가는 앵커 링크이고, 같은 Query 키를 구독하므로 요청이 늘지 않는다.
 * 320px에서는 flex-wrap으로 줄바꿈한다.
 */
/** 제공자 하나의 칩. 훅은 항목마다 자기 컴포넌트에서 호출한다(목록 길이에 안전). */
function SummaryChip({ provider }: { provider: UsageProvider }): ReactNode {
  const { state } = useUsage(provider)
  const meta = providerMetaFor(provider)
  return (
    <li className="min-w-0">
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
}

export function UsageSummary(): ReactNode {
  // 등록부 목록에서 그대로 만든다(제공자가 늘어도 인덱스 하드코딩이 없다).
  const providers = usageProviderIds()
  return (
    <nav aria-label="제공자 요약" className="mt-4">
      <ul className="flex flex-wrap items-center gap-2">
        {providers.map((provider) => (
          <SummaryChip key={provider} provider={provider} />
        ))}
      </ul>
    </nav>
  )
}
