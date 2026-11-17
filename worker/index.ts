import { D1HistoryStore } from './infra/usage/d1-history-store'
import { D1SnapshotStore } from './infra/usage/d1-snapshot-store'
import { createRouter } from './ui/router'
import { readConfig } from './infra/config'
import { JoseAccessVerifier, remoteAccessKeys } from './infra/access/jose-access-verifier'
import type { AccessConfig, AccessTokenVerifier } from './domain/access/verifier'
import type { Env } from './infra/env'
import { D1ExportSource } from './infra/usage/d1-export-store'
import { R2ExportObjectStore } from './infra/usage/r2-export-bucket'
import { runScheduledExport } from './app/usage/export-d1'
import { runBucketWriter } from './app/usage/bucket-writer'
import { classifyScheduledCron, parseDataGeneration } from './domain/usage/export'
import type { ExportSink, ExportSource } from './domain/usage/export'
import { D1BucketStore, D1BucketWriterStore } from './infra/usage/d1-bucket-store'
import { resolveUsageReadStore } from './infra/usage/read-store'
import { USAGE_HISTORY_SCAN_VERSION } from '../shared/usage-history-contract'
import { D1TrendStore } from './infra/trend/d1-trend-store'
import { createModelsDevSource, createOpenRouterSource, createZenSource } from './infra/trend/http-sources'
import { refreshTrendSections } from './app/trend/refresh-trend'
import { refreshPlanModels } from './app/trend/refresh-plan-models'
import { D1PlanStore } from './infra/trend/d1-plan-store'
import { createOllamaTagsSource, createOpenCodeGoSource } from './infra/trend/plan-sources'
import { refreshMetrics } from './app/trend/refresh-metrics'
import { D1MetricsStore } from './infra/trend/d1-metrics-store'
import { createAaSource, createOrRankingSource } from './infra/trend/metrics-sources'
import type { MetricsSourceFailureReason } from './domain/trend/metrics/types'

const createVerifier = (config: Pick<AccessConfig, 'issuer' | 'audience'>): AccessTokenVerifier =>
  new JoseAccessVerifier(config, remoteAccessKeys(config.issuer))

/** Exception messages and arbitrary names may contain sensitive data. */
function safeTrendErrorClass(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError'
  if (error instanceof RangeError) return 'RangeError'
  if (error instanceof SyntaxError) return 'SyntaxError'
  if (error instanceof Error) return 'Error'
  return 'unknown'
}

/** Worker 로그에는 키·본문 없이 상태만 남긴다. */
function metricsLogStatus(reason: MetricsSourceFailureReason | null): string {
  if (reason === null) return 'ok'
  if (reason === 'rate_limited') return '429'
  if (reason === 'unauthorized') return 'unauthorized'
  if (reason === 'not_configured') return 'not_configured'
  return 'error'
}

export interface ScheduledControllerLike {
  cron?: string
  scheduledTime?: number
}
export interface ScheduledContextLike {
  waitUntil?(promise: Promise<unknown>): void
}

/** Request resources and driver implementations are composed only here. */
export function createWorker(deps: {
  createVerifier?: typeof createVerifier
  exportSource?: (env: Env) => ExportSource | null
  exportSink?: (env: Env) => ExportSink | null
  trendFetch?: typeof fetch
  logTrend?: (message: string) => void
  now?: () => number
} = {}) {
  const exportSource = deps.exportSource ?? ((env: Env) => env.DB === undefined ? null : new D1ExportSource(env.DB))
  const exportSink = deps.exportSink ?? ((env: Env) => env.EXPORT_BUCKET === undefined ? null : new R2ExportObjectStore(env.EXPORT_BUCKET))
  return {
    async fetch(request: Request, env: Env, _context?: {waitUntil(promise:Promise<unknown>):void}): Promise<Response> {
      const read = resolveUsageReadStore(env)
      const config = readConfig(env)
      const verifierConfig = config.ok ? config.config : { issuer: 'https://invalid.cloudflareaccess.com', audience: '' }
      const available = read.ok ? env.DB ?? null : null
      const generation = parseDataGeneration(env.USAGE_DATA_GENERATION)
      return createRouter({
        config,
        verifier: (deps.createVerifier ?? createVerifier)(verifierConfig),
        history: new D1HistoryStore(available),
        store: new D1SnapshotStore(available),
        buckets: available === null || generation === null ? null : new D1BucketStore(available, {dataGeneration:generation}),
        trend: env.DB === undefined ? null : new D1TrendStore(env.DB),
        trendAaPublic: env.TREND_AA_PUBLIC === '1',
        assets: env.ASSETS,
      }).fetch(request)
    },
    async scheduled(controller: ScheduledControllerLike, env: Env, _context?: ScheduledContextLike): Promise<void> {
      const nowMs = controller.scheduledTime ?? deps.now?.() ?? Date.now()
      const kind = classifyScheduledCron(controller.cron)
      if (kind === 'trend') {
        const logTrend = deps.logTrend ?? ((message: string) => console.log(message))
        logTrend('trend_refresh:start')
        if (env.DB === undefined) {
          logTrend('trend_refresh_failed:missing_db')
          return
        }
        try {
          const fetchImpl = deps.trendFetch ?? globalThis.fetch
          const result = await refreshTrendSections({
            store: new D1TrendStore(env.DB),
            sources: [
              createModelsDevSource({ fetchImpl }),
              createZenSource({ fetchImpl }),
              createOpenRouterSource({ fetchImpl }),
            ],
            nowMs,
          })
          for (const [source, status] of Object.entries(result.sources)) {
            if (status === 'stale') console.error(`trend_refresh_failed:${source}`)
          }
          try {
            const plan = await refreshPlanModels({
              store: new D1PlanStore(env.DB),
              sources: [
                createOpenCodeGoSource({ fetchImpl }),
                createOllamaTagsSource({ fetchImpl }),
              ],
              catalog: result.catalog,
              nowMs,
            })
            for (const [source, status] of Object.entries(plan.sources)) {
              if (status === 'stale') console.error(`trend_plan_failed:${source}`)
            }
          } catch {
            console.error('trend_plan_failed:unexpected')
          }
          logTrend('trend_refresh:complete')
        } catch (error) {
          logTrend(`trend_refresh_failed:unexpected:${safeTrendErrorClass(error)}`)
        }
        return
      }
      if (kind === 'metrics') {
        if (env.DB === undefined) return
        const aaKey = env.AA_API_KEY?.trim() ?? ''
        const orKey = env.OR_API_KEY?.trim() ?? ''
        try {
          const fetchImpl = deps.trendFetch ?? globalThis.fetch
          const result = await refreshMetrics({
            store: new D1MetricsStore(env.DB),
            aaSource: aaKey === '' ? null : createAaSource({ apiKey: aaKey, fetchImpl }),
            orSource: orKey === '' ? null : createOrRankingSource({ apiKey: orKey, fetchImpl }),
            nowMs,
          })
          console.log(`trend_metrics:aa=${metricsLogStatus(result.reasons.aa)} or=${metricsLogStatus(result.reasons.or)}`)
        } catch {
          console.log('trend_metrics:error')
        }
        return
      }
      if (kind === 'bucket') {
        if (env.DB === undefined) return
        const generation = parseDataGeneration(env.USAGE_DATA_GENERATION)
        if (generation === null) return
        try {
          const result = await runBucketWriter(new D1BucketWriterStore(env.DB), {
            scanVersion: USAGE_HISTORY_SCAN_VERSION,
            dataGeneration: generation,
            nowMs,
          })
          if (!result.ok) console.error(`d1_bucket_failed:${result.reason}`)
        } catch {
          console.error('d1_bucket_failed:unexpected')
        }
        return
      }
      try {
        const result = await runScheduledExport({
          cron: controller.cron,
          source: exportSource(env),
          sink: exportSink(env),
          nowMs,
          dataGeneration: env.USAGE_DATA_GENERATION,
        })
        if (!result.ok) console.error(`d1_export_failed:${result.reason}`)
      } catch {
        console.error('d1_export_failed:unexpected')
      }
    },
  }
}
export default createWorker()
