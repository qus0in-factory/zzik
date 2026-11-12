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
    expect(getTableColumns(usageEvent).id.primary).toBe(true)
  })
})
