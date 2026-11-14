import { useCardActivity } from '@app/usage/useCardActivity'
import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/types'
import type { UsageUiStatus } from '@app/usage/useUsage'
import { Card, CardContent, CardHeader } from '@ui/components/ui/card'
import { Skeleton } from '@ui/components/ui/skeleton'
import { cardPresentation } from '@app/usage/card-presentation'
import { LimitCard } from './LimitCard'
import { StatusBar } from './StatusBar'
import { providerStatusOf } from '@app/usage/provider-status'
import { ProviderIcon } from './ProviderIcon'
import { ProviderStatusLight } from './ProviderStatusLight'
import type { ProviderStatus } from '@app/usage/provider-status'

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
  /** 데이터가 있는 상태에서 재조회 중 — 새로고침 버튼만 바뀌고 본문은 그대로다 */
  refreshing?: boolean
}

/** 사용량 대시보드(ADR 0.3 D8): 제목 → 상태 줄 → 사용 창 → 추가 한도. */
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
  refreshing = false,
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
        {title !== undefined && <SectionTitle provider={provider} title={title} light={null} />}
        <div data-testid="usage-skeleton-status" aria-hidden="true" className="flex items-center justify-between gap-3">
          <Skeleton data-testid="usage-skeleton" className="h-5 w-40" />
          <Skeleton data-testid="usage-skeleton" className="h-[34px] w-[72px]" />
        </div>
        <div aria-hidden="true">
          <Skeleton data-testid="usage-skeleton" className="mb-2 h-6 w-16" />
          <div data-testid="usage-skeleton-grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((index) => (
              <Card key={index} data-testid="usage-skeleton-card" className="min-w-0 gap-3">
                <CardHeader className="gap-1.5">
                  <Skeleton data-testid="usage-skeleton" className="h-6 w-28" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton data-testid="usage-skeleton" className="h-6 w-16" />
                  <Skeleton data-testid="usage-skeleton" className="mt-5 h-2 w-full" />
                  <Skeleton data-testid="usage-skeleton" className="h-4 w-24" />
                  <Skeleton data-testid="usage-skeleton" className="h-4 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>
    )
  }

  const empty = report === null || (report.windows.length === 0 && report.metrics.length === 0)
  const light = providerStatusOf({ status, reportStatus: report?.status ?? null, lastSuccessText })

  return (
    <section {...sectionProps} className="mt-8 scroll-mt-24 space-y-4">
      {title !== undefined && <SectionTitle provider={provider} title={title} light={light} />}
      <StatusBar lastSuccessText={lastSuccessText} onRetry={onRetry} refreshing={refreshing} />

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
            className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
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
    </section>
  )
}

/** 섹션 제목: 아이콘 · 제목 · 연결 상태등. light가 null(로딩 스켈레톤)이면 같은 크기의 자리표시를 둔다. */
function SectionTitle({ provider, title, light }: { provider: UsageProvider; title: string; light: ProviderStatus | null }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <ProviderIcon provider={provider} />
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {light === null ? <Skeleton data-testid="usage-skeleton-light" aria-hidden="true" className="size-2.5 rounded-full" /> : <ProviderStatusLight status={light} />}
    </div>
  )
}

function ActiveLimitCard({ item }: { item: UsageReport['windows'][number] }): ReactNode {
  const lapSeconds = useCardActivity(item.id, item.usedPercent)
  return <LimitCard item={item} titleLevel={4} presentation={cardPresentation(item, lapSeconds)} />
}
