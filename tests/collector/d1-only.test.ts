import {describe,it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {readStorageConfig} from '../../collector/domain/usage/storage-config.mjs'
import {resolveUsageReadStore} from '../../worker/infra/usage/read-store'
const require=createRequire(import.meta.url)
describe('Given the G-stage D1-only storage boundary',()=>{
 it('When storage is implicit Then D1 is the only default and former PG mode is rejected',()=>{
  expect(readStorageConfig({}, {dryRun:true})).toMatchObject({ok:true,mode:'d1'})
  expect(readStorageConfig({ZZIK_STORE:'postgres'}, {dryRun:true})).toEqual({ok:false,reason:'InvalidStoreMode'})
  expect(resolveUsageReadStore({})).toEqual({ok:true,store:'d1'})
  expect(resolveUsageReadStore({USAGE_READ_STORE:'postgres'})).toEqual({ok:false,reason:'storage_unavailable'})
 })
 it('When PM2 uses its ordinary environment Then D1 auth and all reviewed intervals are configured',()=>{
  const app=require('../../collector/ecosystem.config.cjs').apps[0]
  expect(app.env).toMatchObject({ZZIK_STORE:'d1',ZZIK_D1_AUTH:'wrangler-oauth',ZZIK_D1_OAUTH_PROFILE:'zzik-collector',ZZIK_INTERVAL_SEC:'900',ZZIK_INTERVAL_SEC_CODEX:'180',ZZIK_INTERVAL_SEC_ANTIGRAVITY:'180',ZZIK_INTERVAL_SEC_OPENCODE:'180',ZZIK_INTERVAL_SEC_GROK:'180',ZZIK_INTERVAL_SEC_OLLAMA:'180'})
  expect(app.env_postgres).toBeUndefined()
 })
 it('When runtime dependencies are installed Then no PG driver or PGlite test engine remains',()=>{
  const p=require('../../package.json')
  expect(p.dependencies.postgres).toBeUndefined();expect(p.devDependencies['@electric-sql/pglite']).toBeUndefined();expect(p.devDependencies['drizzle-kit']).toBeUndefined()
 })
})
