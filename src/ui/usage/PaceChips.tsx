import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import { providerMetaFor, usageProviderIds } from '@app/usage/provider-meta'
import { summaryPaceOf } from '@app/usage/summary-pace'
import { Skeleton } from '@ui/components/ui/skeleton'
import { useUsage } from '@app/usage/useUsage'

/**
 * 제공자별 페이스 칩 줄: 가장 긴 주기 한도 하나의 `사용률 / 예상 사용률`(`Claude · 주 12% / 59%`).
 * 사용률이 예상을 넘으면 주의 색으로 칠한다. 한도를 고르는 판정은 app(summaryPaceOf)이 하고 ui는 옮기기만 한다.
 * 월·주 한도나 경과율이 없는 제공자는 칩을 그리지 않는다.
 */
/** 첫 로딩 중 칩 자리만 잡아 데이터가 들어와도 줄 높이가 변하지 않게 한다. */
function PaceChipSkeleton(): ReactNode {
  return (
    <li data-testid="usage-pace-skeleton" aria-hidden="true" className="min-w-0">
      <Skeleton className="h-[30px] w-28 rounded-full" />
    </li>
  )
}

function PaceChip({ provider }: { provider: UsageProvider }): ReactNode {
  const { state } = useUsage(provider)
  const pace = state.report === null ? null : summaryPaceOf(state.report.windows, provider)
  if (state.status === 'loading') return <PaceChipSkeleton />
  if (pace === null) return null
  const meta = providerMetaFor(provider)
  const used = Math.round(pace.usedPercent)
  const expected = Math.round(pace.elapsedPercent)
  return (
    <li className="min-w-0">
      <a
        href={`#${meta.sectionId}`}
        data-testid={`usage-pace-${provider}`}
        data-over-pace={pace.overPace}
        title={`${pace.unit} 사용률 ${used}%, 예상 사용률 ${expected}%`}
        className={
          'fade-in inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-3 py-1 text-sm font-medium hover:bg-accent ' +
          (pace.overPace ? 'border-[var(--usage-caution)] text-[var(--usage-caution)]' : 'border-border')
        }
      >
        <span className="truncate">{meta.title}</span>
        <span aria-hidden="true">·</span>
        <span>
          {pace.unit} {used}% / {expected}%
        </span>
      </a>
    </li>
  )
}

export function PaceChips(): ReactNode {
  return (
    <nav aria-label="제공자별 사용 페이스" className="mt-4">
      <ul className="flex flex-wrap items-center gap-2">
        {usageProviderIds().map((provider) => (
          <PaceChip key={provider} provider={provider} />
        ))}
      </ul>
    </nav>
  )
}
