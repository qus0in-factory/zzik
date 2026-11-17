import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import type { TrendPlanConfidence, TrendPlanGroup, TrendPlanItem } from '@shared/trend-contract'
import { useTrendDeps } from '@app/trend/TrendGatewayContext'
import { TrendLoadError, useTrendSection } from '@app/trend/useTrendSection'

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date)
}

function planTitle(id: string): string {
  switch (id) {
    case 'opencode-go': return t('trend.planModels.plan.opencodeGo')
    case 'ollama-cloud': return t('trend.planModels.plan.ollamaCloud')
    case 'antigravity': return t('trend.planModels.plan.antigravity')
    case 'claude-max': return t('trend.planModels.plan.claudeMax')
    case 'grok': return t('trend.planModels.plan.grok')
    case 'codex': return t('trend.planModels.plan.codex')
    default: return id
  }
}

function confidenceLabel(confidence: TrendPlanConfidence): string {
  switch (confidence) {
    case 'account': return t('trend.planModels.confidence.account')
    case 'catalog': return t('trend.planModels.confidence.catalog')
    case 'doc': return t('trend.planModels.confidence.doc')
    case 'partial': return t('trend.planModels.confidence.partial')
  }
}

function noteText(group: TrendPlanGroup): string | null {
  switch (group.note) {
    case 'partial_judgement': return t('trend.planModels.note.partial')
    case 'source_failed': return t('trend.planModels.note.sourceFailed')
    case 'unverified': return t('trend.planModels.note.unverified')
    case 'not_implemented': return t('trend.planModels.note.notImplemented')
    default: return null
  }
}

function badge(text: string, tone: 'default' | 'muted' = 'default'): ReactNode {
  const classes = tone === 'muted'
    ? 'border-border text-muted-foreground'
    : 'border-primary/30 bg-primary/10 text-primary'
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${classes}`}>{text}</span>
}

function ItemRow({ item }: { item: TrendPlanItem }): ReactNode {
  return (
    <li data-testid="trend-plan-item" className="flex flex-wrap items-start justify-between gap-2 py-2">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="break-all text-sm font-medium">{item.name}</span>
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {item.creator !== null && <span>{item.creator}</span>}
          <span>{item.releaseDate === null ? t('trend.planModels.releaseUnknown') : t('trend.planModels.release', { date: item.releaseDate })}</span>
          <span>{t('trend.planModels.firstSeen', { date: formatTime(item.firstSeenAt) })}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {badge(confidenceLabel(item.confidence), 'muted')}
      </span>
    </li>
  )
}

function PlanCard({ group }: { group: TrendPlanGroup }): ReactNode {
  const note = noteText(group)
  return (
    <div data-testid={`trend-plan-${group.id}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{planTitle(group.id)}</h3>
        {group.status === 'partial' && badge(t('trend.planModels.partial'), 'muted')}
        {group.status === 'unavailable' && badge(t('trend.planModels.unavailable'), 'muted')}
      </div>
      {note !== null && <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>}
      {group.items.length > 0 && (
        <ol data-testid={`trend-plan-items-${group.id}`} className="mt-2 flex flex-col divide-y divide-border">
          {group.items.map((item) => <ItemRow key={item.id} item={item} />)}
        </ol>
      )}
    </div>
  )
}

/** `/pub/trend/plan-models`의 요금제별 신규 모델 섹션. 화면 맨 위에 둔다. */
export function PlanModelsSection(): ReactNode {
  const deps = useTrendDeps()
  if (!deps.enabled) return null
  return <PlanModelsSectionContent />
}

function PlanModelsSectionContent(): ReactNode {
  const query = useTrendSection('plan-models')
  const { data, error, isError, isPending, refetch } = query
  const notReady = error instanceof TrendLoadError && error.reason === 'not_ready'
  const plans = data?.plans ?? []

  return (
    <section aria-labelledby="trend-plan-models" className="mb-8" data-testid="trend-plan-models">
      <h2 id="trend-plan-models" className="text-xl font-semibold tracking-tight">{t('trend.planModels.title')}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('trend.planModels.rule')}</p>

      {isPending && <p role="status" className="mt-4 text-sm text-muted-foreground">{t('trend.planModels.loading')}</p>}
      {isError && (notReady ? (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.planModels.empty')}</p>
      ) : (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{t('trend.planModels.error')}</span>
          <button type="button" onClick={() => void refetch()} className="motion-button rounded-md border border-border bg-card px-2.5 py-1.5 font-medium hover:bg-accent">
            {t('trend.planModels.retry')}
          </button>
        </div>
      ))}
      {data !== undefined && plans.length === 0 && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{t('trend.planModels.empty')}</p>
      )}
      {data !== undefined && plans.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {plans.map((group) => <PlanCard key={group.id} group={group} />)}
        </div>
      )}
      {data !== undefined && (
        <p className="mt-3 text-xs text-muted-foreground">{t('trend.planModels.updated', { time: formatTime(data.generatedAt) })}</p>
      )}
    </section>
  )
}
