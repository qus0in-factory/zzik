import { D1SnapshotStore } from './infra/usage/d1-snapshot-store'
import { D1HistoryStore } from './infra/usage/d1-history-store'
import type { HistoryStore } from './domain/usage/history-store'
import { PostgresHistoryStore } from './infra/usage/postgres-history-store'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createRouter } from './ui/router'
import { readConfig } from './infra/config'
import { JoseAccessVerifier, remoteAccessKeys } from './infra/access/jose-access-verifier'
import { createDb } from './infra/usage/db'
import type { DatabaseConnector } from './infra/usage/db'
import { PostgresSnapshotStore } from './infra/usage/postgres-snapshot-store'
import { withRequestResource } from './app/usage/with-request-resource'
import type { RequestContext } from './app/usage/with-request-resource'
import type { AccessConfig, AccessTokenVerifier } from './domain/access/verifier'
import type { Env } from './infra/env'
import { D1ExportSource } from './infra/usage/d1-export-store'
import { R2ExportObjectStore } from './infra/usage/r2-export-bucket'
import { runScheduledExport } from './app/usage/export-d1'
import { runBucketWriter } from './app/usage/bucket-writer'
import { classifyScheduledCron, parseDataGeneration } from './domain/usage/export'
import type { ExportSink, ExportSource } from './domain/usage/export'
import type { BucketStore } from './domain/usage/bucket-store'
import { D1BucketStore, D1BucketWriterStore } from './infra/usage/d1-bucket-store'
import { PostgresBucketStore } from './infra/usage/postgres-bucket-store'
import { resolveUsageReadStore } from './infra/usage/read-store'
import { USAGE_HISTORY_SCAN_VERSION } from '../shared/usage-history-contract'

const connect: DatabaseConnector = (url, options) => {
  const client = postgres(url, options)
  return { db: drizzle(client), close: () => client.end({ timeout: 1 }) }
}
const createVerifier = (config: Pick<AccessConfig, 'issuer' | 'audience'>): AccessTokenVerifier =>
  new JoseAccessVerifier(config, remoteAccessKeys(config.issuer))

export interface ScheduledControllerLike {
  cron?: string
  scheduledTime?: number
}
export interface ScheduledContextLike {
  waitUntil?(promise: Promise<unknown>): void
}

function bucketStoreFor(env: Env, history: HistoryStore): BucketStore | null {
  const read = resolveUsageReadStore(env)
  if (!read.ok) return null
  if (read.store === 'd1') {
    const generation = parseDataGeneration(env.USAGE_DATA_GENERATION)
    return generation === null || env.DB === undefined ? null : new D1BucketStore(env.DB, { dataGeneration: generation })
  }
  return new PostgresBucketStore(history)
}

/** Request resources and driver implementations are composed only here. */
export function createWorker(deps: {
  connect?: DatabaseConnector
  createVerifier?: typeof createVerifier
  exportSource?: (env: Env) => ExportSource | null
  exportSink?: (env: Env) => ExportSink | null
  now?: () => number
} = {}) {
  const exportSource = deps.exportSource ?? ((env: Env) => env.DB === undefined ? null : new D1ExportSource(env.DB))
  const exportSink = deps.exportSink ?? ((env: Env) => env.EXPORT_BUCKET === undefined ? null : new R2ExportObjectStore(env.EXPORT_BUCKET))
  return {
    fetch(request: Request, env: Env, context: RequestContext): Promise<Response> {
      const read = resolveUsageReadStore(env)
      const isD1 = read.ok && read.store === 'd1'
      const config = readConfig(env)
      const verifierConfig = config.ok ? config.config : { issuer: 'https://invalid.cloudflareaccess.com', audience: '' }
      return withRequestResource(
        request,
        () => read.ok && read.store === 'postgres' ? createDb(env, deps.connect ?? connect) : null,
        resource => {
          const history = isD1 ? new D1HistoryStore(env.DB ?? null) : new PostgresHistoryStore(resource?.db ?? null)
          return createRouter({
            config,
            verifier: (deps.createVerifier ?? createVerifier)(verifierConfig),
            history,
            buckets: bucketStoreFor(env, history),
            store: isD1 ? new D1SnapshotStore(env.DB ?? null) : new PostgresSnapshotStore(resource?.db ?? null),
            assets: env.ASSETS,
          }).fetch(request)
        },
        context,
      )
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
