import type { ReactNode } from 'react'
import { History, Loader2, RefreshCw } from 'lucide-react'
import { t } from '@shared/messages'
import type { ChartButtonState } from '@app/usage/history/chart-view'

export interface StatusBarProps {
  lastSuccessText: string | null
  onRetry?: (() => void) | null
  /** 재조회 중: 버튼을 비활성화하고 스피너를 보인다 */
  refreshing?: boolean
  /** 차트 버튼 상태(ADR 0.7 8.2절). null·생략이면 그리지 않는다. */
  chart?: ChartButtonState | null
}

/** 마지막 수집 안내 + [차트 보기] [새로고침]. aria-live로 스크린리더에 알린다. */
export function StatusBar({ lastSuccessText, onRetry = null, refreshing = false, chart = null }: StatusBarProps): ReactNode {
  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {lastSuccessText !== null && (
        <span className="inline-flex basis-full items-center gap-1.5 text-sm text-muted-foreground sm:basis-auto">
          <History aria-hidden="true" className="size-4 shrink-0" />
          {lastSuccessText}
        </span>
      )}
      {chart !== null && (
        <>
          <button
            type="button"
            className="motion-button inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-accent"
            aria-expanded={chart.expanded}
            aria-controls={chart.panelId}
            aria-disabled={chart.disabled || undefined}
            aria-describedby={chart.hint !== null ? `${chart.panelId}-hint` : undefined}
            onClick={() => {
              if (!chart.disabled) chart.onToggle()
            }}
            onPointerEnter={chart.onIntent}
            onFocus={chart.onIntent}
          >
            {chart.label}
          </button>
          {chart.hint !== null && <span id={`${chart.panelId}-hint`} className="sr-only">{chart.hint}</span>}
        </>
      )}
      {onRetry !== null && (
        <button
          type="button"
          onClick={onRetry}
          disabled={refreshing}
          aria-busy={refreshing}
          aria-label={t('action.refresh.aria')}
          className="motion-button inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-accent disabled:cursor-progress disabled:opacity-60"
        >
          {refreshing ? (
            <Loader2 data-testid="refresh-spinner" aria-hidden="true" className="refresh-spinner size-4" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-4" />
          )}
          {t('action.refresh')}
        </button>
      )}
    </div>
  )
}
