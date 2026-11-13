import { describe, it, expect } from 'vitest'
import { readStorageConfig } from '../../collector/domain/usage/storage-config.mjs'

describe('Given PostgreSQL-only storage configuration', () => {
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
