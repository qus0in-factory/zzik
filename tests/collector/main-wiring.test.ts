import { describe, it, expect } from 'vitest'
import { readStorageConfig } from '../../collector/domain/usage/storage-config.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Given a Grok Build credentials override', () => {
  it('When dry-running an expired synthetic login Then reads that file without calling upstream or writing state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zzik-grok-wiring-'))
    try {
      const credentials = join(dir, 'auth.json')
      writeFileSync(credentials, JSON.stringify({
        'https://auth.x.ai::synthetic': { key: 'synthetic-expired', expires_at: '2020-01-01T00:00:00.123456Z' },
      }))
      const result = spawnSync(process.execPath, ['collector/main.mjs', '--once', '--dry-run', '--provider', 'grok', '--credentials-file', credentials], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, ZZIK_STORE: 'postgres', ZZIK_STATE_DIR: dir, ZZIK_LOG_PATH: join(dir, 'log'), ZZIK_PROVIDERS: 'grok' },
      })
      expect(result.stdout).toContain('status=token_expired')
      expect(result.stdout).toContain('called=0')
      expect(result.stdout).not.toContain('synthetic-expired')
      expect(readdirSync(dir)).toEqual(['auth.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Given PostgreSQL-only storage configuration', () => {
  it('When PG writes request sub-900 global or provider intervals Then rejects before opening a database', () => {
    for(const env of [{ZZIK_INTERVAL_SEC:'180'},{ZZIK_INTERVAL_SEC_OLLAMA:'180'}])expect(readStorageConfig({DB_URL:'postgres://fake',...env}).ok).toBe(false)
  })
  it('When mode is missing Then uses PostgreSQL with the 900 second and 30 day defaults', () => {
    expect(readStorageConfig({DB_URL:'postgres://fake'})).toEqual({ok:true,mode:'postgres',intervalSec:900,retentionDays:30})
  })
  it('When PostgreSQL is explicit Then accepts the tracked ecosystem mode', () => {
    expect(readStorageConfig({ZZIK_STORE:'postgres',DB_URL:'postgres://fake'})).toMatchObject({ok:true,mode:'postgres'})
  })
  it.each(['kv','both','unknown'])('When the obsolete mode %s is configured Then fails closed', mode => {
    expect(readStorageConfig({ZZIK_STORE:mode,DB_URL:'postgres://fake'})).toEqual({ok:false,reason:'InvalidStoreMode'})
  })
  it('When DB credentials are absent Then fails closed even for a previous KV configuration', () => {
    expect(readStorageConfig({})).toEqual({ok:false,reason:'MissingDatabaseConfiguration'})
    expect(readStorageConfig({ZZIK_STORE:'kv'})).toEqual({ok:false,reason:'InvalidStoreMode'})
  })
  it('When dry-running Then requires no DB access but still rejects obsolete write modes', () => {
    expect(readStorageConfig({}, {dryRun:true})).toMatchObject({ok:true,mode:'postgres'})
    expect(readStorageConfig({ZZIK_STORE:'both'}, {dryRun:true})).toEqual({ok:false,reason:'InvalidStoreMode'})
  })
})

describe('Given an explicit local interval capability and synthetic expired credentials',()=>{
 it('When D1 dry-run validates 180/179 without remote access Then accepts only the valid capability and leaves the state directory untouched',()=>{
  const dir=mkdtempSync(join(tmpdir(),'zzik-b3-capability-'))
  try{
   const credentials=join(dir,'auth.json')
   writeFileSync(credentials,JSON.stringify({'https://auth.x.ai::synthetic':{key:'synthetic-expired',expires_at:'2020-01-01T00:00:00Z'}}))
   const run=(interval:string)=>spawnSync(process.execPath,['collector/main.mjs','--once','--dry-run','--provider','grok','--credentials-file',credentials],{encoding:'utf8',timeout:10000,env:{...process.env,ZZIK_STORE:'d1',ZZIK_STATE_DIR:dir,ZZIK_PROVIDERS:'grok',ZZIK_INTERVAL_SEC:'900',ZZIK_INTERVAL_SEC_OLLAMA:interval}})
   expect(run('180').status).toBe(78)
   writeFileSync(join(dir,'interval-capability.json'),JSON.stringify({v:1,readStore:'d1',bucketRoute:true}))
   const accepted=run('180');expect(accepted.status).toBe(0);expect(accepted.stdout).toContain('called=0')
   expect(run('179').status).toBe(78)
   expect(readdirSync(dir).sort()).toEqual(['auth.json','interval-capability.json'])
  }finally{rmSync(dir,{recursive:true,force:true})}
 })
})
