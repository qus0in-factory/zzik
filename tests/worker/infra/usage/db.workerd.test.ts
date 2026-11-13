import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { describe, expect, it } from 'vitest'

/** Explicit opt-in, read-only: real workerd sockets and production adapters.
 * Credentials and stored envelopes stay inside memory; only booleans cross back.
 * Local authentication is injected, never deployed or used against Access.
 */
describe.skipIf(!process.env.DB_URL)('Given a TLS PostgreSQL URL requiring channel binding', () => {
  it('When the actual Worker reads in workerd Then all six snapshots decode through verified TLS and SCRAM', async () => {
    const url = new URL(process.env.DB_URL!)
    url.searchParams.set('sslmode', 'require')
    url.searchParams.set('channel_binding', 'require')
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../../../', import.meta.url)),
        contents: `
          import { createWorker } from './worker/index.ts';
          import { decodeUsageSnapshot } from './src/domain/usage/snapshot.ts';
          const worker = createWorker({createVerifier: () => ({verify: async () => ({ok:true,claims:{email:'test@example.invalid'}})})});
          export default {async fetch(request, env, ctx) {
            const providers=['claude','codex','antigravity','opencode','grok','ollama'];
            const checks=await Promise.all(providers.map(async provider => {
              const response=await worker.fetch(new Request('https://local/api/usage/'+provider,{headers:{'Cf-Access-Jwt-Assertion':'synthetic'}}),env,ctx);
              const body=await response.json();
              return {provider,status:response.status,decoded:decodeUsageSnapshot(body,provider).ok};
            }));
            return Response.json(checks);
          }};
        `,
      },
      bundle: true, write: false, format: 'esm', platform: 'neutral',
      conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:sockets', 'node:*'],
      plugins: [{ name: 'node-builtins', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => builtinModules.includes(args.path)
          ? { path: args.path.startsWith('node:') ? args.path : 'node:' + args.path, external: true } : undefined)
      } }],
      logLevel: 'silent',
    })
    const mf = new Miniflare({
      workers: [{ config: {
        name: 'zzik-db-test', compatibilityDate: '2026-11-11', compatibilityFlags: ['nodejs_compat'],
        manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } },
        env: {
          DB_URL: { type: 'text', value: url.toString() },
          ACCESS_TEAM_DOMAIN: { type: 'text', value: 'test.cloudflareaccess.com' },
          ACCESS_AUD: { type: 'text', value: 'synthetic-audience' },
          ALLOWED_EMAIL: { type: 'text', value: 'test@example.invalid' },
        },
      } }],
      log: new Log(LogLevel.NONE),
    })
    try {
      const response = await mf.dispatchFetch('https://local/')
      const checks = await response.json()
      expect(checks).toEqual(['claude','codex','antigravity','opencode','grok','ollama']
        .map(provider => ({ provider, status: 200, decoded: true })))
    } finally { await mf.dispose() }
  }, 60_000)
})
