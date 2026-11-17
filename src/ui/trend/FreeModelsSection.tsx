import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import type { TrendItem } from '@shared/trend-contract'
import { useTrendDeps } from '@app/trend/TrendGatewayContext'
import { TrendLoadError, useTrendSection } from '@app/trend/useTrendSection'

const SOURCE_LABELS: Record<string, string> = {
  'go-models': 'OpenCode Go',
  'ollama-tags': 'Ollama Cloud',
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
  return (
    <li data-testid="trend-free-model" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words text-base font-semibold">{item.name}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{item.creator}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {item.free && badge(t('trend.freeModels.included'))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{item.releaseDate === null ? t('trend.freeModels.releaseUnknown') : t('trend.freeModels.release', { date: item.releaseDate })}</span>
      </div>
    </li>
  )
}

function Group({ title, items }: { title: string; items: readonly TrendItem[] }): ReactNode {
  if (items.length === 0) return null
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 grid gap-3 sm:grid-cols-2">
        {items.map((item) => <ItemCard key={`${item.freeKind ?? 'plan'}:${item.id}`} item={item} />)}
      </ul>
    </div>
  )
}

/** `/pub/trend/free-models`의 무료 모델 섹션. 호스팅 무료와 로컬 실행 가능을 나눠 보여 준다. */
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
  const ollamaCloud = data?.items.filter((item) => item.freeKind === 'ollama-cloud') ?? []
  const stale = data?.sources.some((source) => source.status === 'stale') ?? false

  return (
    <section aria-labelledby="trend-free-models" className="mb-8" data-testid="trend-free-models">
      <h2 id="trend-free-models" className="text-xl font-semibold tracking-tight">{t('trend.freeModels.title')}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('trend.freeModels.rule')}</p>

      {isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('trend.freeModels.loading')}</p>}
      {isError && (notReady ? (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.freeModels.empty')}</p>
      ) : (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{t('trend.freeModels.error')}</span>
          <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-accent">
            {t('trend.freeModels.retry')}
          </button>
        </div>
      ))}
      {data !== undefined && data.items.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.freeModels.empty')}</p>
      )}
      {data !== undefined && data.items.length > 0 && (
        <>
          <Group title={t('trend.freeModels.group.opencodeGo')} items={opencodeGo} />
          <Group title={t('trend.freeModels.group.ollamaCloud')} items={ollamaCloud} />
        </>
      )}
      {data !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('trend.freeModels.source', {
            sources: data.sources.map((source) => SOURCE_LABELS[source.id] ?? source.id).join(' · '),
            time: formatTime(data.generatedAt),
          })}
        </p>
      )}
      {stale && <p className="mt-1 text-xs text-muted-foreground">{t('trend.freeModels.stale')}</p>}
    </section>
  )
}
