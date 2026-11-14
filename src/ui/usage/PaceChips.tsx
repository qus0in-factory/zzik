import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import { providerMetaFor, usageProviderIds } from '@app/usage/provider-meta'
import { summaryPaceOf } from '@app/usage/summary-pace'
import { Skeleton } from '@ui/components/ui/skeleton'
import { ProviderIcon } from './ProviderIcon'
import { useUsage } from '@app/usage/useUsage'

/**
 * 제공자별 페이스 칩 줄: 가장 긴 주기 한도 하나의 `사용률 / 예상 사용률`(`[아이콘] W 12% / 59%`(월간은 M)).
 * 사용률이 예상을 넘으면 주의 색으로 칠한다. 한도를 고르는 판정은 app(summaryPaceOf)이 하고 ui는 옮기기만 한다.
 * 월·주 한도나 경과율이 없는 제공자는 칩을 그리지 않는다.
 */
/** 첫 로딩 중 칩 자리만 잡아 데이터가 들어와도 줄 높이가 변하지 않게 한다. */
function PaceChipSkeleton(): ReactNode {
  return (
    <li data-testid="usage-pace-skeleton" aria-hidden="true" className="shrink-0">
      <Skeleton className="h-[30px] w-24 rounded-full" />
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
    <li className="shrink-0">
      <a
        href={`#${meta.sectionId}`}
        data-testid={`usage-pace-${provider}`}
        data-over-pace={pace.overPace}
        title={`${meta.title} · ${pace.unit === '월' ? '월간' : '주간'} 사용률 ${used}%, 예상 사용률 ${expected}%`}
        className={
          'fade-in inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border bg-card px-1.5 py-1 text-xs font-medium hover:bg-accent lg:gap-1.5 lg:px-2.5 lg:text-sm ' +
          (pace.overPace ? 'border-[var(--usage-caution)] text-[var(--usage-caution)]' : 'border-border')
        }
      >
        <ProviderIcon provider={provider} label={meta.title} className="size-3.5 lg:size-4" />
        <span className="tabular-nums">
          {pace.unit === '월' ? 'M' : 'W'} {used}% / {expected}%
        </span>
      </a>
    </li>
  )
}

export function PaceChips(): ReactNode {
  return (
    <nav aria-label="제공자별 사용 페이스" className="mt-4">
      <ul className="flex min-h-[30px] flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] lg:gap-2">
        {usageProviderIds().map((provider) => (
          <PaceChip key={provider} provider={provider} />
        ))}
      </ul>
    </nav>
  )
}
