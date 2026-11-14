import { extraSpendPresentation } from '@app/usage/extra-spend'
import { ExtraSpendRow } from './ExtraSpendRow'
import { useCardActivity } from '@app/usage/useCardActivity'
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { UsageCollectionStatus } from '@app/usage/load-usage'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/types'
import type { UsageUiStatus } from '@app/usage/useUsage'
import type { ChartButtonState } from '@app/usage/history/chart-view'
import { Card, CardContent, CardHeader } from '@ui/components/ui/card'
import { Skeleton } from '@ui/components/ui/skeleton'
import { cardPresentation } from '@app/usage/card-presentation'
import { LimitCard } from './LimitCard'
import { LimitRow, LimitTable, LIST_ROW_CLASS } from './LimitRow'
import { useViewMode } from '@app/usage/ViewModeContext'
import { StatusBar } from './StatusBar'
import { Sparkles } from 'lucide-react'
import { t } from '@shared/messages'
import { cardKindOf } from '@app/usage/card-kind'
import { providerStatusOf } from '@app/usage/provider-status'
import { ProviderIcon } from './ProviderIcon'
import { ProviderStatusLight } from './ProviderStatusLight'
import { ExternalLink } from 'lucide-react'
import { providerUsageLink } from '@app/usage/provider-usage-links'
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
  /** 수집기 상태(상태등 판정용). 봉투가 없으면 null */
  collectionStatus?: UsageCollectionStatus | null
  /** 차트 버튼(ADR 0.7). null·생략이면 상태 줄에 버튼을 그리지 않는다. */
  chart?: ChartButtonState | null
  /** 상태 줄·안내 아래, 카드 위에 놓이는 차트 패널 슬롯. */
  chartPanel?: ReactNode
}

/** 사용량 대시보드(ADR 0.3 D8): 제목 → 상태 줄 → 사용 창 → 추가 한도. */
export function UsageDashboard({
  provider,
  title,
  metricsTitle = t('section.metrics.model'),
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
  collectionStatus = null,
  chart = null,
  chartPanel = null,
}: UsageDashboardProps): ReactNode {
  const { mode: viewMode } = useViewMode()
  const listMode = viewMode === 'list'
  const sectionProps = {
    'data-testid': `usage-section-${provider}`,
    'data-provider': provider,
    'aria-label': ariaLabel ?? title ?? t('section.ariaLabel.default'),
    ...(sectionId !== undefined ? { id: sectionId } : {}),
  } as const

  if (status === 'loading') {
    return (
      <section {...sectionProps} aria-busy="true" className="mt-8 scroll-mt-24 space-y-4">
        {title !== undefined && (
          <SectionTitle provider={provider} title={title} light={null}>
            <div data-testid="usage-skeleton-status" aria-hidden="true" className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="basis-full sm:basis-auto">
                <Skeleton data-testid="usage-skeleton" className="h-5 w-36" />
              </div>
              {chart !== null && <Skeleton data-testid="usage-skeleton" className="h-[34px] w-[84px]" />}
              <Skeleton data-testid="usage-skeleton" className="h-[34px] w-[72px]" />
            </div>
          </SectionTitle>
        )}
        <div aria-hidden="true">
          {listMode ? (
            <div data-testid="usage-skeleton-list" className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <div className="hidden h-[29px] border-b bg-muted/40 sm:block" />
              {[0, 1].map((index) => (
                <div key={index} data-testid="usage-skeleton-row" className={`${LIST_ROW_CLASS} flex items-center gap-3 border-b px-3 last:border-b-0`}>
                  <Skeleton data-testid="usage-skeleton" className="h-5 w-32" />
                  <Skeleton data-testid="usage-skeleton" className="ml-auto h-5 w-12" />
                  <Skeleton data-testid="usage-skeleton" className="h-2 w-24 sm:w-40" />
                </div>
              ))}
            </div>
          ) : (
          <div data-testid="usage-skeleton-grid" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[0, 1].map((index) => (
              <Card key={index} data-testid="usage-skeleton-card" className="min-w-0 gap-3">
                <CardHeader className="gap-1.5">
                  <Skeleton data-testid="usage-skeleton" className="h-6 w-28" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton data-testid="usage-skeleton" className="h-6 w-16" />
                  <Skeleton data-testid="usage-skeleton" className="mt-[1.625rem] h-2 w-full" />
                  <Skeleton data-testid="usage-skeleton" className="h-4 w-24" />
                  <Skeleton data-testid="usage-skeleton" className="h-4 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
          )}
        </div>
      </section>
    )
  }

  const extraSpend = extraSpendPresentation(report?.extraSpend)
  const empty = report === null || (report.windows.length === 0 && report.metrics.length === 0)
  const light = providerStatusOf({ status, reportStatus: report?.status ?? null, collectionStatus, issueCount: report?.issues.length ?? 0, lastSuccessText })

  return (
    <section {...sectionProps} className="mt-8 scroll-mt-24 space-y-4">
      {title !== undefined ? (
        <SectionTitle provider={provider} title={title} light={light}>
          <StatusBar lastSuccessText={lastSuccessText} onRetry={onRetry} refreshing={refreshing} chart={chart} />
        </SectionTitle>
      ) : (
        <StatusBar lastSuccessText={lastSuccessText} onRetry={onRetry} refreshing={refreshing} chart={chart} />
      )}

      {collectionNote !== null && (
        <p data-testid="collection-note" aria-live="polite" className="min-w-0 break-words rounded-lg border p-3 text-sm text-muted-foreground">
          {collectionNote}
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
          <div className="min-w-0 space-y-1">
            <span data-testid="usage-error-text" className="block break-words text-sm">
              {errorMessage ?? t('section.error.default')}
            </span>
            {refreshHint !== null && collectionNote === null && (
              <span data-testid="provider-hint" className="block text-xs text-muted-foreground">
                {refreshHint}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onRetry ?? undefined}
            className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
          >
            {t('action.retry')}
          </button>
        </div>
      )}

      {status === 'stale' && (
        <div role="status" aria-live="polite" className="rounded-lg border p-3 text-sm text-muted-foreground">
          {staleNoteText !== null && <span>{staleNoteText}</span>}
          {refreshHint !== null && collectionNote === null && (
            <span data-testid="provider-hint" className="block text-xs">
              {refreshHint}
            </span>
          )}
        </div>
      )}

      {chartPanel}

      {empty && extraSpend === null && status === 'ready' && <p className="text-sm text-muted-foreground">{t('section.empty')}</p>}

      {!empty && report !== null && (
        // key: 로딩 → ready 전환 때 카드가 새로 마운트되어 진입 연출(막대·저빌·페이드인)이 다시 재생된다. 새로고침(같은 ready)에서는 같은 노드라 재생하지 않는다.
        <Fragment key={`ready-${viewMode}`}>
          {report.windows.length > 0 &&
            (listMode ? (
              <LimitTable testId={`usage-list-${provider}`} caption={t('list.caption', { provider: title ?? provider, group: t('list.group.windows') })}>
                {report.windows.map((item, index) => (
                  <ActiveLimitRow key={item.id} item={item} index={index} group="window" />
                ))}
              </LimitTable>
            ) : (
              <div data-testid={`usage-grid-${provider}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {report.windows.map((item, index) => (
                  <ActiveLimitCard key={item.id} item={item} index={index} group="window" />
                ))}
              </div>
            ))}
          {report.metrics.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-semibold">
                <Sparkles aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {metricsTitle}
              </h3>
              {listMode ? (
                <LimitTable testId={`usage-list-${provider}`} caption={t('list.caption', { provider: title ?? provider, group: metricsTitle })}>
                  {report.metrics.map((item, index) => (
                    <ActiveLimitRow key={item.id} item={item} index={index} group="metric" />
                  ))}
                </LimitTable>
              ) : (
                <div data-testid={`usage-grid-${provider}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {report.metrics.map((item, index) => (
                    <ActiveLimitCard key={item.id} item={item} index={index} group="metric" />
                  ))}
                </div>
              )}
            </div>
          )}
        </Fragment>
      )}
      {extraSpend !== null && <ExtraSpendRow view={extraSpend} />}
    </section>
  )
}

/** 섹션 제목 줄: 왼쪽 아이콘 · 제목 · 연결 상태등, 오른쪽 children(마지막 수집 시각 + 새로고침). 좁으면 줄바꿈.  light가 null(로딩 스켈레톤)이면 같은 크기의 자리표시를 둔다. */
function SectionTitle({ provider, title, light, children }: { provider: UsageProvider; title: string; light: ProviderStatus | null; children?: ReactNode }): ReactNode {
  const usageUrl = providerUsageLink(provider)
  return (
    <div className="flex min-h-[34px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex items-center gap-2">
        <ProviderIcon provider={provider} />
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {light === null ? <Skeleton data-testid="usage-skeleton-light" aria-hidden="true" className="size-2.5 rounded-full" /> : <ProviderStatusLight status={light} />}
        {usageUrl !== null && (
          <a
            href={usageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('provider.usagePage.open', { provider: title })}
            title={t('provider.usagePage.open', { provider: title })}
            className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            data-testid="provider-usage-link"
          >
            <ExternalLink className="size-[14px]" aria-hidden="true" />
          </a>
        )}
      </div>
      {/* 좁은 화면에서는 항상 다음 줄로 내린다(폰트 로딩 전후 폭 차이로 줄바꿈 여부가 흔들리지 않게) */}
      {children !== undefined && <div className="basis-full sm:basis-auto">{children}</div>}
    </div>
  )
}

/** 목록 모드의 한 행. 저빌 활동(달리기)은 카드에서만 보이므로 활동 기록 훅은 부르지 않는다. */
function ActiveLimitRow({ item, index, group }: { item: UsageReport['windows'][number]; index: number; group: 'window' | 'metric' }): ReactNode {
  const { barLevel, barLevelText } = cardPresentation(item, null)
  return <LimitRow item={item} presentation={{ barLevel, barLevelText }} enterIndex={index} kind={cardKindOf(item, group)} />
}

function ActiveLimitCard({ item, index, group }: { item: UsageReport['windows'][number]; index: number; group: 'window' | 'metric' }): ReactNode {
  const lapSeconds = useCardActivity(item.id, item.usedPercent)
  return <LimitCard item={item} titleLevel={4} presentation={cardPresentation(item, lapSeconds)} enterIndex={index} kind={cardKindOf(item, group)} />
}
