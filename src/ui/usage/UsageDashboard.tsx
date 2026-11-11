import type { ReactNode } from 'react'
import type { UsageReport } from '@domain/usage/types'
import type { UsageUiStatus } from '@app/usage/useUsage'
import { Badge } from '@ui/components/ui/badge'
import { Skeleton } from '@ui/components/ui/skeleton'
import { LimitCard } from './LimitCard'
import { OtherItems } from './OtherItems'
import { RawJson } from './RawJson'
import { StatusBar } from './StatusBar'

export interface UsageDashboardProps {
  status: UsageUiStatus
  report: UsageReport | null
  errorMessage: string | null
  onRetry?: (() => void) | null
  /** 상태 줄 안내(`마지막 수집 11:58 (2분 전)`) — app에서 계산된 문구 */
  lastSuccessText?: string | null
  /** stale 안내(`마지막 성공 2분 전`) — app에서 계산된 문구 */
  staleNoteText?: string | null
}

const READY_BADGE: Record<'normal' | 'warn' | 'limit' | 'unknown', string> = {
  normal: '정상',
  warn: '주의',
  limit: '한도 도달',
  unknown: '데이터 없음',
}

/** 사용량 대시보드(D9): 상태 줄 → 사용 창 → 모델·기능별 한도 → 기타 항목 → 원본 JSON. */
export function UsageDashboard({
  status,
  report,
  errorMessage,
  onRetry = null,
  lastSuccessText = null,
  staleNoteText = null,
}: UsageDashboardProps): ReactNode {
  if (status === 'loading') {
    return (
      <section aria-label="사용량" data-testid="usage-section" aria-busy="true" className="mt-8">
        <div aria-hidden="true" className="space-y-3 motion-reduce:[&_*]:animate-none">
          <Skeleton data-testid="usage-skeleton" className="h-8 w-32" />
          <Skeleton data-testid="usage-skeleton" className="h-2 w-full" />
          <Skeleton data-testid="usage-skeleton" className="h-24 w-full" />
        </div>
      </section>
    )
  }

  const empty = report === null || (report.windows.length === 0 && report.metrics.length === 0)
  const badge =
    status === 'stale'
      ? '오래된 데이터'
      : status === 'error'
        ? '오류'
        : report === null
          ? '데이터 없음'
          : READY_BADGE[report.status]

  return (
    <section aria-label="사용량" data-testid="usage-section" className="mt-8 space-y-6">
      <StatusBar badge={badge} lastSuccessText={lastSuccessText} onRetry={onRetry} />

      {status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <span className="text-sm">{errorMessage ?? '사용량을 불러오지 못했습니다'}</span>
          <button
            type="button"
            onClick={onRetry ?? undefined}
            className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
          >
            다시 시도
          </button>
        </div>
      )}

      {status === 'stale' && (
        <div role="status" aria-live="polite" className="rounded-lg border p-3 text-sm text-muted-foreground">
          {staleNoteText !== null && <span>{staleNoteText}</span>}
        </div>
      )}

      {empty && status === 'ready' && <p className="text-sm text-muted-foreground">표시할 사용량이 없습니다</p>}

      {!empty && report !== null && (
        <>
          <div>
            <h2 className="mb-2 text-base font-semibold">사용 창</h2>
            <div data-testid="usage-grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {report.windows.map((item) => (
                <LimitCard key={item.id} item={item} />
              ))}
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-base font-semibold">모델·기능별 한도</h2>
            <div data-testid="usage-grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {report.metrics.map((item) => (
                <LimitCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        </>
      )}

      {report !== null && <OtherItems others={report.others} />}
      {report !== null && <RawJson raw={report.raw} />}
    </section>
  )
}
