import type { ReactNode } from 'react'
import { Badge } from '@ui/components/ui/badge'

export interface StatusBarProps {
  badge: string
  lastSuccessText: string | null
  onRetry?: (() => void) | null
}

/** 상태 줄: 배지 + 마지막 수집 안내 + 새로고침(저장된 값 재읽기). aria-live로 스크린리더에 알린다. */
export function StatusBar({ badge, lastSuccessText, onRetry = null }: StatusBarProps): ReactNode {
  return (
    <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{badge}</Badge>
        {lastSuccessText !== null && <span className="text-sm text-muted-foreground">{lastSuccessText}</span>}
      </div>
      {onRetry !== null && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="사용량 새로고침(저장된 값을 다시 읽습니다)"
          className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
        >
          새로고침
        </button>
      )}
    </div>
  )
}
