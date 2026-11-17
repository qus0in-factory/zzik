import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { t } from '@shared/messages'
import type { TrendItem } from '@shared/trend-contract'
import { useTrendDeps } from '@app/trend/TrendGatewayContext'
import { TrendLoadError, useTrendSection } from '@app/trend/useTrendSection'

const SOURCE_LABELS: Record<string, string> = {
  'go-models': 'OpenCode Go',
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

function badge(text: string, tone: 'default' | 'accent' = 'default'): ReactNode {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
      tone === 'accent' ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
    }`}>
      {text}
    </span>
  )
}

function ItemCard({ item }: { item: TrendItem }): ReactNode {
  const sourceHref = item.links.opencode
  return (
    <li data-testid="trend-free-model" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words text-base font-semibold">{item.name}</h4>
          {item.creator.trim() !== '' && <p className="mt-0.5 text-xs text-muted-foreground">{item.creator}</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          {item.free && badge(t('trend.freeModels.badge.free'))}
          {item.limitedTime && badge(t('trend.freeModels.badge.limitedTime'))}
          {item.limitedRegions && badge(t('trend.freeModels.badge.limitedRegions'))}
          {item.recentlyAdded && badge(t('trend.freeModels.badge.recent'), 'accent')}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{item.releaseDate === null ? t('trend.freeModels.releaseUnknown') : t('trend.freeModels.release', { date: item.releaseDate })}</span>
        {sourceHref !== undefined && (
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
          >
            <span>{t('trend.freeModels.link.pricing')}</span>
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>
    </li>
  )
}

/** `/pub/trend/free-models`의 무료 모델 섹션. OpenCode Go 무료 항목만 보여 주며 비면 숨긴다. */
export function FreeModelsSection(): ReactNode {
  const deps = useTrendDeps()
  if (!deps.enabled) return null
  return <FreeModelsSectionContent />
}

function FreeModelsSectionContent(): ReactNode {
  const query = useTrendSection('free-models')
  const { data, error, isError, isPending, refetch } = query
  const notReady = error instanceof TrendLoadError && error.reason === 'not_ready'
  const opencodeGo = data?.items.filter((item) => item.freeKind === 'opencode-go') ?? []
  const stale = data?.sources.some((source) => source.status === 'stale') ?? false

  if (isError && notReady) return null
  if (data !== undefined && opencodeGo.length === 0) return null

  return (
    <section aria-labelledby="trend-free-models" className="mb-8" data-testid="trend-free-models">
      <h2 id="trend-free-models" className="text-xl font-semibold tracking-tight">{t('trend.freeModels.title')}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('trend.freeModels.rule')}</p>

      {isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('trend.freeModels.loading')}</p>}
      {isError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{t('trend.freeModels.error')}</span>
          <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-accent">
            {t('trend.freeModels.retry')}
          </button>
        </div>
      )}
      {data !== undefined && (
        <>
          <div className="mt-4">
            <h3 className="text-sm font-semibold">{t('trend.freeModels.group.opencodeGo')}</h3>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2">
              {opencodeGo.map((item) => <ItemCard key={`${item.freeKind ?? 'free'}:${item.id}`} item={item} />)}
            </ul>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('trend.freeModels.source', {
              sources: data.sources.map((source) => SOURCE_LABELS[source.id] ?? source.id).join(' · '),
              time: formatTime(data.generatedAt),
            })}
          </p>
        </>
      )}
      {stale && <p className="mt-1 text-xs text-muted-foreground">{t('trend.freeModels.stale')}</p>}
    </section>
  )
}
