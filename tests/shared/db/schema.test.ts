import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { usageSnapshot, usageEvent } from '../../../shared/db/schema'
describe('Given the persisted usage envelope contract', () => {
  it('When inspecting tables Then keeps snapshot and event data separate with mandatory envelope fields', () => {
    expect(getTableName(usageSnapshot)).toBe('usage_snapshot')
    expect(getTableName(usageEvent)).toBe('usage_event')
    const columns=getTableColumns(usageSnapshot)
    expect(Object.values(columns).map(c=>c.name)).toEqual(['provider','envelope','status','run_at','fetched_at','raw_sha256','collector_version','updated_at'])
    expect(columns.provider.primary).toBe(true)
    expect(columns.envelope.notNull).toBe(true)
    expect(columns.runAt.notNull).toBe(true)
    expect(columns.fetchedAt.notNull).toBe(false)
    expect(columns.rawSha256.notNull).toBe(false)
    const event=getTableColumns(usageEvent)
    expect(Object.values(event).map(c=>c.name)).toEqual(['id','provider','run_at','status','raw_sha256','envelope'])
    expect(event.id.primary).toBe(true)
    expect(event.envelope.notNull).toBe(true)
    expect(event.provider.notNull).toBe(true)
    expect(event.rawSha256.notNull).toBe(false)
  })
})

describe('Given generated SQL migrations', () => {
  it('When checked Then includes both tables, identity event keys and the descending history index', () => {
    const dir=fileURLToPath(new URL('../../../drizzle/',import.meta.url))
    const source=readdirSync(dir).filter(name=>name.endsWith('.sql')).map(name=>readFileSync(dir+name,'utf8')).join('\n')
    expect(source).toContain('CREATE TABLE "usage_snapshot"')
    expect(source).toContain('CREATE TABLE "usage_event"')
    expect(source).toContain('GENERATED ALWAYS AS IDENTITY')
    expect(source).toContain('"usage_event_provider_run_at"')
    expect(source).toContain('"run_at" DESC')
  })
})
