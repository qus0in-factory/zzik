import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import { useTrendDeps } from '@app/trend/TrendGatewayContext'
import { TrendLoadError, useTrendSection } from '@app/trend/useTrendSection'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

function badge(text: string): ReactNode {
  return <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">{text}</span>
}

function sourceLabel(source: string): string {
  if (source === 'models.dev') return 'models.dev'
  if (source === 'openrouter') return 'OpenRouter'
  return source
}

/** `/pub/trend/new-models`의 최근 7일 새 모델 섹션. 데이터가 없거나 실패해도 링크 목록은 아래에 남는다. */
export function NewModelsSection(): ReactNode {
  const deps = useTrendDeps()
  if (!deps.enabled) return null
  return <NewModelsSectionContent />
}

function NewModelsSectionContent(): ReactNode {
  const query = useTrendSection('new-models')
  const { data, error, isError, isPending, refetch } = query
  const notReady = error instanceof TrendLoadError && error.reason === 'not_ready'

  return (
    <section aria-labelledby="trend-new-models" className="mb-8" data-testid="trend-new-models">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="trend-new-models" className="text-xl font-semibold tracking-tight">{t('trend.newModels.title')}</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('trend.newModels.rule')}</p>

      {isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('trend.newModels.loading')}</p>}
      {isError && (notReady ? (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.newModels.empty')}</p>
      ) : (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{t('trend.newModels.error')}</span>
          <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-accent">
            {t('trend.newModels.retry')}
          </button>
        </div>
      ))}
      {data !== undefined && data.items.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.newModels.empty')}</p>
      )}
      {data !== undefined && data.items.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.id} data-testid="trend-new-model" className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold">{item.name}</h3>
                  {item.creator !== '' && <p className="mt-0.5 text-xs text-muted-foreground">{item.creator}</p>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(item.registeredIn ?? []).includes('openrouter') && badge(t('trend.newModels.source.openrouter'))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{item.releaseDate === null ? t('trend.newModels.releaseUnknown') : t('trend.newModels.release', { date: item.releaseDate })}</span>
                <span>{t('trend.newModels.providers', { count: item.providers.length })}</span>
                {item.price !== null && <span>{t('trend.newModels.price', { input: item.price.input, output: item.price.output })}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">{t('trend.newModels.source', {
          sources: data.sources.map((source) => sourceLabel(source.id)).join(' · '),
          time: formatTime(data.generatedAt),
        })}</p>
      )}
    </section>
  )
}
