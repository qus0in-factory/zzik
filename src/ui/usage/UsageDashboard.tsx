import { useCardActivity } from '@app/usage/useCardActivity'
import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/types'
import type { UsageUiStatus } from '@app/usage/useUsage'
import { Badge } from '@ui/components/ui/badge'
import { Skeleton } from '@ui/components/ui/skeleton'
import { LimitCard } from './LimitCard'
import { OtherItems } from './OtherItems'
import { StatusBar } from './StatusBar'
import { READY_BADGE } from './status-label'

export interface UsageDashboardProps {
  provider: UsageProvider
  /** 섹션 제목(`Claude`, `ChatGPT (Codex)`). 페이지에서 h2로 렌더된다. */
  title?: string
  /** 두 번째 블록 제목(`모델·기능별 한도`, `추가 한도`) */
  metricsTitle?: string
  /** 섹션 id/aria-label. 앵커 칩의 이동 대상이다. */
  sectionId?: string
  ariaLabel?: string
  /** 상태가 정상이 아닐 때 보여 줄 갱신 안내 */
  refreshHint?: string | null
  status: UsageUiStatus
  report: UsageReport | null
  errorMessage: string | null
  onRetry?: (() => void) | null
  /** 상태 줄 안내(`마지막 수집 11:58 (2분 전)`) — app에서 계산된 문구 */
  lastSuccessText?: string | null
  /** stale 안내(`마지막 성공 2분 전`) — app에서 계산된 문구 */
  staleNoteText?: string | null
  /** 수집 상태별 안내(ADR 0.3 v2 D4 표) — app에서 계산된 문구 */
  collectionNote?: string | null
}

/** 사용량 대시보드(ADR 0.3 D8): 제목 → 상태 줄 → 사용 창 → 추가 한도 → 기타 항목. */
export function UsageDashboard({
  provider,
  title,
  metricsTitle = '모델·기능별 한도',
  sectionId,
  ariaLabel,
  refreshHint = null,
  status,
  report,
  errorMessage,
  onRetry = null,
  lastSuccessText = null,
  staleNoteText = null,
  collectionNote = null,
}: UsageDashboardProps): ReactNode {
  const sectionProps = {
    'data-testid': `usage-section-${provider}`,
    'data-provider': provider,
    'aria-label': ariaLabel ?? title ?? '사용량',
    ...(sectionId !== undefined ? { id: sectionId } : {}),
  } as const

  if (status === 'loading') {
    return (
      <section {...sectionProps} aria-busy="true" className="mt-8 scroll-mt-24 space-y-4">
        {title !== undefined && <h2 className="text-xl font-semibold tracking-tight">{title}</h2>}
        <div aria-hidden="true" className="space-y-3 motion-reduce:[&_*]:animate-none">
          <Skeleton data-testid="usage-skeleton" className="h-8 w-32" />
          <Skeleton data-testid="usage-skeleton" className="h-2 w-full" />
          <Skeleton data-testid="usage-skeleton" className="h-24 w-full" />
        </div>
      </section>
    )
  }

  const empty = report === null || (report.windows.length === 0 && report.metrics.length === 0 && report.others.length === 0)
  const badge =
    status === 'stale'
      ? '오래된 데이터'
      : status === 'error'
        ? '오류'
        : report === null
          ? '데이터 없음'
          : READY_BADGE[report.status]

  return (
    <section {...sectionProps} className="mt-8 scroll-mt-24 space-y-4">
      {title !== undefined && <h2 className="text-xl font-semibold tracking-tight">{title}</h2>}
      <StatusBar badge={badge} lastSuccessText={lastSuccessText} onRetry={onRetry} />

      {refreshHint !== null && status !== 'ready' && collectionNote === null && (
        <p data-testid="provider-hint" className="text-sm text-muted-foreground">
          {refreshHint}
        </p>
      )}

      {collectionNote !== null && (
        <p data-testid="collection-note" aria-live="polite" className="min-w-0 break-words rounded-lg border p-3 text-sm text-muted-foreground">
          {collectionNote}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <span data-testid="usage-error-text" className="min-w-0 break-words text-sm">
            {errorMessage ?? '사용량을 불러오지 못했습니다'}
          </span>
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
          {report.windows.length > 0 && <div>
            <h3 className="mb-2 text-base font-semibold">사용 창</h3>
            <div data-testid={`usage-grid-${provider}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {report.windows.map((item) => (
                <ActiveLimitCard key={item.id} item={item} />
              ))}
            </div>
          </div>}
          {report.metrics.length > 0 && (
            <div>
              <h3 className="mb-2 text-base font-semibold">{metricsTitle}</h3>
              <div data-testid={`usage-grid-${provider}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {report.metrics.map((item) => (
                  <ActiveLimitCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {report !== null && <OtherItems others={report.others} />}
    </section>
  )
}

function ActiveLimitCard({ item }: { item: UsageReport['windows'][number] }): ReactNode {
  const lapSeconds = useCardActivity(item.id, item.usedPercent)
  return <LimitCard item={item} titleLevel={4} lapSeconds={lapSeconds} />
}
