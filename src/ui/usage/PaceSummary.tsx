import type { ReactNode } from 'react'
import type { BarLevel } from '@domain/usage/bar-level'
import type { UsageProvider } from '@domain/usage/providers'
import type { SummaryPace } from '@app/usage/summary-pace'
import { providerMetaFor } from '@app/usage/provider-meta'
import { t } from '@shared/messages'
import { ProviderIcon } from './ProviderIcon'

const PACE_LEVEL_CLASS: Record<BarLevel, string> = {
  neutral: 'border-border',
  ok: 'border-border',
  caution: 'border-[var(--usage-caution)] text-[var(--usage-caution)]',
  danger: 'border-[var(--usage-danger)] text-[var(--usage-danger)]',
}

/** 최상단 칩과 차트가 같은 선택·값·표시를 공유한다. */
export function PaceSummary({ provider, pace }: { provider: UsageProvider; pace: SummaryPace }): ReactNode {
  const meta = providerMetaFor(provider)
  const used = Math.round(pace.usedPercent)
  const expected = Math.round(pace.elapsedPercent)
  return (
    <span
      title={t('chips.title', { provider: meta.title, period: t(pace.unit === 'month' ? 'chips.period.month' : 'chips.period.week'), used, expected })}
      data-over-pace={pace.overPace}
      data-bar-level={pace.barLevel}
      className={'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border bg-card group-hover:bg-accent px-1 py-1 text-[11px] font-medium lg:gap-1.5 lg:px-2.5 lg:text-sm ' + PACE_LEVEL_CLASS[pace.barLevel]}
    >
      <ProviderIcon provider={provider} label={meta.title} className="size-3 lg:size-4" />
      <span className="tabular-nums">{t(pace.unit === 'month' ? 'chips.unit.month' : 'chips.unit.week')} {used}% / {expected}%</span>
    </span>
  )
}
