import { describe, it, expect } from 'vitest'
import { readStorageConfig } from '../../collector/domain/usage/storage-config.mjs'
describe('Given storage transition configuration', () => {
  it('When mode is missing Then defaults to dual writes and 900 seconds', () => {
    expect(readStorageConfig({DB_URL:'postgres://fake'})).toEqual({ok:true,mode:'both',intervalSec:900,retentionDays:30})
  })
  it.each(['kv','postgres','both'])('When %s is selected Then accepts supported mode', mode => {
    expect(readStorageConfig({ZZIK_STORE:mode,DB_URL:'postgres://fake'})).toMatchObject({ok:true,mode})
  })
  it('When PostgreSQL needs credentials Then fails closed; dry-run never needs DB access', () => {
    expect(readStorageConfig({})).toMatchObject({ok:false})
    expect(readStorageConfig({ZZIK_STORE:'unknown',DB_URL:'postgres://fake'})).toMatchObject({ok:false})
    expect(readStorageConfig({ZZIK_STORE:'kv'})).toMatchObject({ok:true})
    expect(readStorageConfig({}, {dryRun:true})).toMatchObject({ok:true})
  })
})
