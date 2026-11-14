import type { ReactNode } from 'react'
import { History, Loader2, RefreshCw } from 'lucide-react'
import { t } from '@shared/messages'

export interface StatusBarProps {
  lastSuccessText: string | null
  onRetry?: (() => void) | null
  /** 재조회 중: 버튼을 비활성화하고 스피너를 보인다 */
  refreshing?: boolean
}

/** 마지막 수집 안내 + 새로고침(저장된 값 재읽기). aria-live로 스크린리더에 알린다. */
export function StatusBar({ lastSuccessText, onRetry = null, refreshing = false }: StatusBarProps): ReactNode {
  return (
    <div aria-live="polite" className="flex items-center gap-3">
      {lastSuccessText !== null && (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <History aria-hidden="true" className="size-4 shrink-0" />
          {lastSuccessText}
        </span>
      )}
      {onRetry !== null && (
        <button
          type="button"
          onClick={onRetry}
          disabled={refreshing}
          aria-busy={refreshing}
          aria-label={t('action.refresh.aria')}
          className="motion-button inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:bg-accent disabled:cursor-progress disabled:opacity-60"
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
