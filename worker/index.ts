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

const connect: DatabaseConnector = (url, options) => {
  const client = postgres(url, options)
  return { db: drizzle(client), close: () => client.end({ timeout: 1 }) }
}
const createVerifier = (config: Pick<AccessConfig, 'issuer' | 'audience'>): AccessTokenVerifier =>
  new JoseAccessVerifier(config, remoteAccessKeys(config.issuer))

/** Request resources and driver implementations are composed only here. */
export function createWorker(deps: {
  connect?: DatabaseConnector
  createVerifier?: typeof createVerifier
} = {}) {
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
          store: new PostgresSnapshotStore(resource?.db ?? null),
          assets: env.ASSETS,
        }).fetch(request),
        context,
      )
    },
  }
}
export default createWorker()
