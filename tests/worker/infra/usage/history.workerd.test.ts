import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { describe, expect, it } from 'vitest';
/** Always local: no DB_URL, sockets, secrets or production database. */
describe('Given fixture history inside actual workerd', () => {
  it('When all six routes and summary are called Then samples decode without exposing raw data', async () => {
    const fixtures = Object.fromEntries(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'].map(p => [p, readFileSync(new URL(`../../../fixtures/${p}-usage.normal.json`, import.meta.url), 'utf8')]));
    const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../../../../', import.meta.url)), contents: `
  import {createRouter} from './worker/ui/router.ts';
  const fixtures=${JSON.stringify(fixtures)};
  const config={ok:true,config:{teamDomain:'test.cloudflareaccess.com',issuer:'https://test.cloudflareaccess.com',audience:'test',allowedEmail:'test@example.invalid'}};
  const history={async readRows(provider,query){return {ok:true,value:[{id:'1',runAt:'2026-11-11T12:00:00.000Z',status:'ok',fetchedAt:'2026-11-11T12:00:00.000Z',intervalSec:'900',rawText:fixtures[provider],rawRedacted:[]},{id:'2',runAt:'2026-11-11T12:00:00.000Z',status:'ok',fetchedAt:null,intervalSec:'bad',rawText:'poison',rawRedacted:[]}].slice(0,query.limit)}},async readAnchorRow(){return {ok:true,value:null}},async readSummary(providers){return {ok:true,value:providers.map(provider=>({provider,okCount:4,firstOkAt:'2026-11-01T00:00:00Z',lastOkAt:'2026-11-11T00:00:00Z'}))}}};
  const app=createRouter({config,history,verifier:{verify:async()=>({ok:true,claims:{email:'test@example.invalid'}})},store:{read:async()=>({ok:true,value:null})},assets:{fetch:async()=>new Response('fixture')}});
  export default {fetch(request){return app.fetch(request)}};
 ` }, bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
    const mf = new Miniflare({ workers: [{ config: { name: 'history-fixture-test', compatibilityDate: '2026-11-11', manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } } } }], log: new Log(LogLevel.NONE) });
    try {
      for (const provider of Object.keys(fixtures)) {
        const r = await mf.dispatchFetch('http://local/api/usage-history/' + provider + '?limit=2', { headers: { 'Cf-Access-Jwt-Assertion': 'fixture' } });
        expect(r.status).toBe(200);
        expect(r.headers.get('Cache-Control')).toBe('no-store');
        const page = await r.json() as any;
        expect(page.scanVersion).toBe(2);
        expect(page.samples).toHaveLength(2);
        expect(page.samples[0].values?.length).toBeGreaterThan(0);
        expect(page.samples[1].values).toBeNull();
        expect(page.nextCursor).toBe('2026-11-11T12:00:00.000Z_2');
        expect(JSON.stringify(page)).not.toMatch(/rawText|rawRedacted|utilization|remainingFraction/);
      }
      const summary = await mf.dispatchFetch('http://local/api/usage-history', { headers: { 'Cf-Access-Jwt-Assertion': 'fixture' } });
      expect(summary.status).toBe(200);
      expect((await summary.json() as any).summary).toHaveLength(6);
    }
    finally {
      await mf.dispose();
    }
  }, 30000);
});
