import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { AaTrendLoadError, useAaTrend, useAaTrendDeps } from '@app/trend/AaTrendContext'
import { useAaTrendExpanded } from '@app/trend/useAaTrendExpanded'
import { t } from '@shared/messages'
import type { AaTrendModelItem } from '@shared/trend-contract'

type AaTab = 'intelligence' | 'price' | 'speed'
type TableMode = AaTab | 'cost'

const PANEL_ID = 'usage-aa-trend-panel'

function formatNum(value: number | null, digits = 2): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}

function AaModelTable({
  caption,
  rows,
  mode,
}: {
  caption: string
  rows: readonly AaTrendModelItem[]
  mode: TableMode
}): ReactNode {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-border bg-muted/40 text-muted-foreground">
          <tr>
            <th scope="col" className="whitespace-nowrap px-2.5 py-2 font-medium sm:px-3">{t('usage.trend.col.rank')}</th>
            <th scope="col" className="whitespace-nowrap px-2.5 py-2 font-medium sm:px-3">{t('usage.trend.col.model')}</th>
            <th scope="col" className="hidden whitespace-nowrap px-3 py-2 font-medium sm:table-cell">{t('usage.trend.col.creator')}</th>
            {mode === 'intelligence' && (
              <>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.intelligence')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.priceIn')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.priceOut')}</th>
              </>
            )}
            {mode === 'price' && (
              <>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.priceIn')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.priceOut')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.intelligence')}</th>
              </>
            )}
            {mode === 'cost' && (
              <>
                <th scope="col" className="min-w-[3.5rem] px-2.5 py-2 text-right font-medium sm:min-w-0 sm:whitespace-nowrap sm:px-3">{t('usage.trend.col.costPerTask')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.priceOut')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.intelligence')}</th>
              </>
            )}
            {mode === 'speed' && (
              <>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.speed')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.ttft')}</th>
                <th scope="col" className="whitespace-nowrap px-2.5 py-2 text-right font-medium sm:px-3">{t('usage.trend.col.intelligence')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((item, idx) => (
            <tr key={item.slug} className="hover:bg-muted/20">
              <td className="whitespace-nowrap px-2.5 py-2 tabular-nums text-muted-foreground sm:px-3">{idx + 1}</td>
              <td className={`break-keep [overflow-wrap:anywhere] px-2.5 py-2 font-medium text-foreground sm:px-3${mode === 'cost' ? ' min-w-[5rem]' : ''}`}>
                <div>{item.name}</div>
                {item.creator !== '' && (
                  <div className="mt-0.5 text-[11px] font-normal text-muted-foreground sm:hidden">{item.creator}</div>
                )}
              </td>
              <td className="hidden break-keep [overflow-wrap:anywhere] px-3 py-2 text-muted-foreground sm:table-cell">{item.creator || '—'}</td>
              {mode === 'intelligence' && (
                <>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-semibold tabular-nums sm:px-3">{formatNum(item.intelligenceIndex, 1)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.priceIn)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.priceOut)}</td>
                </>
              )}
              {mode === 'price' && (
                <>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums sm:px-3">{formatNum(item.priceIn)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums sm:px-3">{formatNum(item.priceOut)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.intelligenceIndex, 1)}</td>
                </>
              )}
              {mode === 'cost' && (
                <>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums sm:px-3">{formatNum(item.costPerTask, 2)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.priceOut)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.intelligenceIndex, 1)}</td>
                </>
              )}
              {mode === 'speed' && (
                <>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums sm:px-3">{formatNum(item.outputTokensPerSecond, 1)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right font-medium tabular-nums sm:px-3">{formatNum(item.timeToFirstTokenSeconds, 2)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-muted-foreground sm:px-3">{formatNum(item.intelligenceIndex, 1)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** `/usage` 하단 접이식 트렌드 패널. 기본 접힘 상태이며 펼칠 때만 `/api/trend/aa`를 호출한다. */
export function AaTrendPanel(): ReactNode {
  const deps = useAaTrendDeps()
  const [expanded, toggleExpanded] = useAaTrendExpanded(deps.storage)
  const [tab, setTab] = useState<AaTab>('intelligence')
  const { data, error, isError, isPending, refetch } = useAaTrend(expanded)
  if (!deps.enabled) return null
  const notReady = error instanceof AaTrendLoadError && error.reason === 'not_ready'

  return (
    <section aria-labelledby="usage-aa-trend-heading" className="mt-10 w-full min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="usage-aa-trend">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="usage-aa-trend-heading" className="text-base font-semibold tracking-tight">{t('usage.trend.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('usage.trend.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/trend" className="motion-button rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            {t('usage.trend.publicLink')}
          </Link>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={PANEL_ID}
            onClick={toggleExpanded}
            className="motion-button inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <span>{expanded ? t('usage.trend.collapse') : t('usage.trend.expand')}</span>
            {expanded ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div id={PANEL_ID} className="mt-4 space-y-4 border-t border-border pt-4">
          {isPending && <p role="status" className="text-sm text-muted-foreground">{t('usage.trend.loading')}</p>}
          {isError && (notReady ? (
            <p className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">{t('usage.trend.empty')}</p>
          ) : (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <span>{t('usage.trend.error')}</span>
              <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent">
                {t('usage.trend.retry')}
              </button>
            </div>
          ))}
          {data !== undefined && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label={t('usage.trend.title')} className="inline-flex rounded-lg border border-border bg-background p-0.5">
                  {([
                    ['intelligence', t('usage.trend.tab.intelligence')],
                    ['price', t('usage.trend.tab.price')],
                    ['speed', t('usage.trend.tab.speed')],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => setTab(key)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${tab === key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{t('usage.trend.meta', { day: data.day, version: data.indexVersion })}</span>
              </div>

              {tab === 'intelligence' && (
                <AaModelTable caption={t('usage.trend.tab.intelligence')} rows={data.intelligenceTop} mode="intelligence" />
              )}
              {tab === 'price' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">{t('usage.trend.group.priceLowest')}</h3>
                    <AaModelTable caption={t('usage.trend.group.priceLowest')} rows={data.priceLowest} mode="price" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">{t('usage.trend.group.costLowest')}</h3>
                    <AaModelTable caption={t('usage.trend.group.costLowest')} rows={data.costLowest} mode="cost" />
                  </div>
                </div>
              )}
              {tab === 'speed' && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">{t('usage.trend.group.speedHighest')}</h3>
                    <AaModelTable caption={t('usage.trend.group.speedHighest')} rows={data.speedHighest} mode="speed" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground">{t('usage.trend.group.latencyLowest')}</h3>
                    <AaModelTable caption={t('usage.trend.group.latencyLowest')} rows={data.latencyLowest} mode="speed" />
                  </div>
                </div>
              )}

              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>Source: Artificial Analysis (</span>
                <a
                  href="https://artificialanalysis.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
                >
                  artificialanalysis.ai
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
                <span>)</span>
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
