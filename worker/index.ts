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

const createVerifier = (config: Pick<AccessConfig, 'issuer' | 'audience'>): AccessTokenVerifier =>
  new JoseAccessVerifier(config, remoteAccessKeys(config.issuer))

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
        trend: null,
        assets: env.ASSETS,
      }).fetch(request)
    },
    async scheduled(controller: ScheduledControllerLike, env: Env, _context?: ScheduledContextLike): Promise<void> {
      const nowMs = controller.scheduledTime ?? deps.now?.() ?? Date.now()
      const kind = classifyScheduledCron(controller.cron)
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
