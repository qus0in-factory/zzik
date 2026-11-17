import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import type { TrendMetricsBlock, TrendMetricsEntry } from '@shared/trend-contract'
import { useTrendDeps } from '@app/trend/TrendGatewayContext'
import { TrendLoadError, useTrendSection } from '@app/trend/useTrendSection'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

function displayAsOf(value: string): string {
  if (!value.includes('T')) return value
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

function badge(text: string, tone: 'default' | 'warn' = 'default'): ReactNode {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
      tone === 'warn' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'
    }`}>
      {text}
    </span>
  )
}

function rankDeltaLabel(delta: number | null): string | null {
  if (delta === null) return null
  if (delta === 0) return t('trend.metrics.delta.same')
  return delta > 0 ? t('trend.metrics.delta.up', { value: delta }) : t('trend.metrics.delta.down', { value: -delta })
}

function shareDeltaLabel(delta: number | null): string | null {
  if (delta === null || Math.abs(delta) < 0.0005) return null
  const value = (Math.abs(delta) * 100).toFixed(1)
  return delta > 0 ? t('trend.metrics.share.up', { value }) : t('trend.metrics.share.down', { value })
}

function EntryRow({ block, entry }: { block: TrendMetricsBlock; entry: TrendMetricsEntry }): ReactNode {
  const kind = entry.kind === 'new-top' ? t('trend.metrics.kind.newTop') : entry.kind === 'moved' ? t('trend.metrics.kind.moved') : null
  return (
    <li data-testid="trend-metrics-entry" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-muted-foreground">{entry.rank}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span className="break-all text-sm font-medium">{entry.name}</span>
        {entry.creator !== null && <span className="text-xs text-muted-foreground">{entry.creator}</span>}
        {kind !== null && badge(kind)}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {block.id === 'aa-intelligence' && entry.index !== undefined && (
          <span className="tabular-nums">{t('trend.metrics.aa.index', { index: entry.index })}</span>
        )}
        {block.id === 'or-usage' && entry.share7d !== undefined && (
          <span className="tabular-nums">{t('trend.metrics.or.share', { share: (entry.share7d * 100).toFixed(1) })}</span>
        )}
        {block.id === 'aa-intelligence' && rankDeltaLabel(entry.rankDelta) !== null && (
          <span className="tabular-nums text-foreground/80">{rankDeltaLabel(entry.rankDelta)}</span>
        )}
        {block.id === 'or-usage' && shareDeltaLabel(entry.shareDelta ?? null) !== null && (
          <span className="tabular-nums text-foreground/80">{shareDeltaLabel(entry.shareDelta ?? null)}</span>
        )}
      </span>
    </li>
  )
}

function Block({ block }: { block: TrendMetricsBlock }): ReactNode {
  const title = block.id === 'aa-intelligence' ? t('trend.metrics.aa.title') : t('trend.metrics.or.title')
  const attribution = block.id === 'aa-intelligence'
    ? t('trend.metrics.attribution.aa', { version: block.version ?? '-', day: block.asOf })
    : t('trend.metrics.attribution.or', { asOf: block.asOf })
  const note = block.note === 'baseline'
    ? t('trend.metrics.baseline')
    : block.note === 'version_changed'
      ? t('trend.metrics.versionChanged')
      : block.note === 'source_failed'
        ? t('trend.metrics.sourceFailed')
        : null

  return (
    <div data-testid={`trend-metrics-${block.id}`} className="mt-5 first:mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="flex flex-wrap items-center gap-1">
          {block.version !== undefined && <span className="text-xs text-muted-foreground">v{block.version}</span>}
          <span className="text-xs text-muted-foreground">{displayAsOf(block.asOf)}</span>
          {block.status === 'stale' && badge(t('trend.metrics.stale'), 'warn')}
        </div>
      </div>
      {block.status === 'not_configured' ? (
        <p className="mt-2 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.metrics.notConfigured')}</p>
      ) : (
        <>
          {note !== null && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
          {block.entries.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('trend.metrics.empty')}</p>
          ) : (
            <ol className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border bg-card px-3 py-1">
              {block.entries.map((entry) => <EntryRow key={`${block.id}:${entry.id}`} block={block} entry={entry} />)}
            </ol>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{attribution}</p>
        </>
      )}
    </div>
  )
}

/** `/pub/trend/metrics`의 성능 지표 섹션. AA와 OpenRouter 블록을 각각 격리해 보여 준다. */
export function MetricsSection(): ReactNode {
  const deps = useTrendDeps()
  if (!deps.enabled) return null
  return <MetricsSectionContent />
}

function MetricsSectionContent(): ReactNode {
  const query = useTrendSection('metrics')
  const { data, error, isError, isPending, refetch } = query
  const notReady = error instanceof TrendLoadError && error.reason === 'not_ready'
  const blocks = data?.blocks ?? []

  return (
    <section aria-labelledby="trend-metrics" className="mb-8" data-testid="trend-metrics">
      <h2 id="trend-metrics" className="text-xl font-semibold tracking-tight">{t('trend.metrics.title')}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('trend.metrics.rule')}</p>

      {isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('trend.metrics.loading')}</p>}
      {isError && (notReady ? (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.metrics.empty')}</p>
      ) : (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{t('trend.metrics.error')}</span>
          <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-accent">
            {t('trend.metrics.retry')}
          </button>
        </div>
      ))}
      {data !== undefined && blocks.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.metrics.empty')}</p>
      )}
      {data !== undefined && blocks.map((block) => <Block key={block.id} block={block} />)}
      {data !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">{t('trend.metrics.updated', { time: formatTime(data.generatedAt) })}</p>
      )}
    </section>
  )
}
