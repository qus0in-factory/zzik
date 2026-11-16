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
import type { ExportSink, ExportSource } from './domain/usage/export'

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
      const config = readConfig(env)
      const verifierConfig = config.ok ? config.config : { issuer: 'https://invalid.cloudflareaccess.com', audience: '' }
      return withRequestResource(
        request,
        () => createDb(env, deps.connect ?? connect),
        resource => createRouter({
          config,
          verifier: (deps.createVerifier ?? createVerifier)(verifierConfig),
          history: new PostgresHistoryStore(resource?.db ?? null),
          store: new PostgresSnapshotStore(resource?.db ?? null),
          assets: env.ASSETS,
        }).fetch(request),
        context,
      )
    },
    async scheduled(controller: ScheduledControllerLike, env: Env, _context?: ScheduledContextLike): Promise<void> {
      try {
        const result = await runScheduledExport({
          cron: controller.cron,
          source: exportSource(env),
          sink: exportSink(env),
          nowMs: controller.scheduledTime ?? deps.now?.() ?? Date.now(),
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
