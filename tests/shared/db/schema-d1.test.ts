import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import {
  usageBucketBoundary,
  usageBucketCheckpoint,
  usageEvent,
  usageExportLog,
  usageSnapshot,
  usageWriteReceipt,
} from '../../../shared/db/schema.d1'

const migration = readFileSync(fileURLToPath(new URL('../../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')

describe('Given the D1 migration is the schema source of truth', () => {
  it('When migration SQL is inspected Then all A-stage tables, strict typing and indexes exist', () => {
    for (const table of ['usage_snapshot', 'usage_event', 'usage_write_receipt', 'usage_bucket_checkpoint', 'usage_bucket_boundary', 'usage_export_log']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
    }
    expect(migration.match(/STRICT/g)).toHaveLength(6)
    expect(migration).toContain('AUTOINCREMENT')
    expect(migration).toContain('usage_event_provider_run_at')
    expect(migration).toContain('usage_write_receipt_created_at')
    expect(migration).toContain("row_kind = 'flat'")
    expect(migration).toContain("row_kind = 'point'")
  })

  it('When receipt and event constraints are inspected Then receipt PK is NOT NULL, JSON must be object and integer columns use typeof checks', () => {
    expect(migration).toMatch(/operation_id\s+TEXT\s+NOT\s+NULL\s+PRIMARY\s+KEY/)
    expect(migration).toMatch(/CHECK\s*\(\s*json_valid\(envelope\)\s+AND\s+json_type\(envelope\)\s*=\s*'object'\s*\)/)
    expect(migration).toMatch(/typeof\(run_at\)\s*=\s*'integer'/)
    expect(migration).toMatch(/typeof\(write_seq\)\s*=\s*'integer'/)
    expect(migration).toMatch(/UNIQUE\s*\(provider,\s*write_seq\)/)
  })

  it('When boundary indexes are inspected Then flat and point use different partial unique keys', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX[^;]+usage_bucket_boundary_flat[^;]+\(provider, scan_version, data_generation, bucket_start_ms\)[^;]+WHERE row_kind = 'flat'/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX[^;]+usage_bucket_boundary_point[^;]+\(provider, scan_version, data_generation, source_event_id\)[^;]+WHERE row_kind = 'point'/)
  })
})

describe('Given the Drizzle D1 schema mirrors the migration', () => {
  it('When table metadata is inspected Then names and columns match the D1 tables', () => {
    expect(getTableName(usageSnapshot)).toBe('usage_snapshot')
    expect(Object.values(getTableColumns(usageSnapshot)).map(c => c.name)).toEqual([
      'provider', 'envelope', 'status', 'run_at', 'fetched_at', 'raw_sha256', 'collector_version', 'updated_at', 'write_seq', 'operation_id',
    ])
    expect(getTableName(usageEvent)).toBe('usage_event')
    expect(Object.values(getTableColumns(usageEvent)).map(c => c.name)).toEqual([
      'id', 'provider', 'run_at', 'status', 'raw_sha256', 'envelope', 'operation_id',
    ])
    expect(getTableName(usageWriteReceipt)).toBe('usage_write_receipt')
    expect(Object.values(getTableColumns(usageWriteReceipt)).map(c => c.name)).toEqual([
      'operation_id', 'provider', 'write_seq', 'payload_sha256', 'created_at_ms',
    ])
    expect(getTableName(usageBucketCheckpoint)).toBe('usage_bucket_checkpoint')
    expect(getTableName(usageBucketBoundary)).toBe('usage_bucket_boundary')
    expect(getTableName(usageExportLog)).toBe('usage_export_log')
  })

  it('When primary keys and partial indexes are inspected Then the invariants are represented in schema metadata', () => {
    const receipt = getTableConfig(usageWriteReceipt)
    expect(receipt.primaryKeys).toHaveLength(1)
    expect(receipt.primaryKeys[0]!.columns.map(c => c.name)).toEqual(['operation_id'])
    expect(receipt.uniqueConstraints.flatMap(c => c.columns.map(c => c.name))).toEqual(expect.arrayContaining(['provider', 'write_seq']))
    expect(getTableConfig(usageEvent).indexes.map(i => i.config.name)).toContain('usage_event_provider_run_at')
    const flat = getTableConfig(usageBucketBoundary).indexes.find(i => i.config.name === 'usage_bucket_boundary_flat')
    const point = getTableConfig(usageBucketBoundary).indexes.find(i => i.config.name === 'usage_bucket_boundary_point')
    expect(flat?.config.unique).toBe(true)
    expect(point?.config.unique).toBe(true)
    expect(flat?.config.where).toBeDefined()
    expect(point?.config.where).toBeDefined()
    expect(getTableConfig(usageWriteReceipt).indexes.map(i => i.config.name)).toContain('usage_write_receipt_created_at')
  })
})
