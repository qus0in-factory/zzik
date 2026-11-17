import { D1TrendStore } from '../worker/infra/trend/d1-trend-store'
import { D1PlanStore } from '../worker/infra/trend/d1-plan-store'
import { D1MetricsStore } from '../worker/infra/trend/d1-metrics-store'
import { createGoModelsSource, createModelsDevSource, createOpenRouterSource } from '../worker/infra/trend/http-sources'
import { createOpenCodeGoSource, createOllamaTagsSource } from '../worker/infra/trend/plan-sources'
import { createAaSource, createOrRankingSource } from '../worker/infra/trend/metrics-sources'
import { refreshTrendSections } from '../worker/app/trend/refresh-trend'
import { refreshPlanModels } from '../worker/app/trend/refresh-plan-models'
import { refreshMetrics } from '../worker/app/trend/refresh-metrics'

export async function refresh(db: any, keys: { aa: string; or: string }, nowMs: number, fetchImpl: typeof fetch) {
  const trend = await refreshTrendSections({ store: new D1TrendStore(db), sources: [createModelsDevSource({ fetchImpl }), createGoModelsSource({ fetchImpl }), createOpenRouterSource({ fetchImpl })], nowMs })
  const plan = await refreshPlanModels({ store: new D1PlanStore(db), sources: [createOpenCodeGoSource({ fetchImpl }), createOllamaTagsSource({ fetchImpl })], catalog: trend.catalog, nowMs })
  const metrics = await refreshMetrics({ store: new D1MetricsStore(db), aaSource: keys.aa ? createAaSource({ apiKey: keys.aa, fetchImpl }) : null, orSource: keys.or ? createOrRankingSource({ apiKey: keys.or, fetchImpl }) : null, nowMs })
  const rows = await db.prepare('SELECT section, payload FROM trend_section').bind().all()
  const counts: Record<string, number> = {}
  for (const row of rows.results) {
    const payload = JSON.parse(row.payload)
    counts[row.section] = row.section === 'plan-models' ? payload.plans.reduce((n: number, group: any) => n + (group.items?.length ?? 0), 0) : row.section === 'metrics' ? payload.blocks.reduce((n: number, block: any) => n + block.entries.length, 0) : payload.items.length
  }
  const observations = await db.prepare('SELECT baseline, COUNT(*) AS count FROM trend_plan_observation GROUP BY baseline').bind().all()
  return { counts, planObservations: observations.results, catalogCount: trend.catalog?.length ?? 0, sources: trend.sources, planSources: plan.sources, metricBlocks: metrics.blocks, metricReasons: metrics.reasons }
}
