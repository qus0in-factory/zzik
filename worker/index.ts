import { createRouter } from './ui/router'
import { readConfig } from './infra/config'
import { JoseAccessVerifier, remoteAccessKeys } from './infra/access/jose-access-verifier'
import { KvSnapshotStore } from './infra/usage/kv-snapshot-store'
import type { Env } from './infra/env'

export default {
  fetch(request: Request, env: Env) {
    const config = readConfig(env)
    const verifierConfig = config.ok ? config.config : { issuer: 'https://invalid.cloudflareaccess.com', audience: '' }
    return createRouter({ config, verifier: new JoseAccessVerifier(verifierConfig, remoteAccessKeys(verifierConfig.issuer)), store: new KvSnapshotStore(env.USAGE_KV), assets: env.ASSETS }).fetch(request)
  },
}
