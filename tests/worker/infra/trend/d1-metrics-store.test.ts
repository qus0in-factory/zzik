import { describe, expect, it } from 'vitest'
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../worker/infra/usage/d1-history-store'
import { D1MetricsStore } from '../../../../worker/infra/trend/d1-metrics-store'
import type { AaSnapshotRow, OrRankingRow } from '../../../../worker/domain/trend/metrics/types'

interface RecordedStatement {
  sql: string
  params: unknown[]
}

class FakeStatement implements D1PreparedStatementLike {
  constructor(
    private readonly db: FakeDb,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): D1PreparedStatementLike {
    return new FakeStatement(this.db, this.sql, values)
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success?: boolean }> {
    return { results: [], success: true }
  }
  async run(): Promise<unknown> {
    this.db.individualRuns += 1
    return {}
  }
}

class FakeDb {
  batches: RecordedStatement[][] = []
  individualRuns = 0
  failBatch = false
  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query)
  }
  async batch(statements: D1PreparedStatementLike[]): Promise<Array<{ success?: boolean }>> {
    if (this.failBatch) throw new Error('batch failed')
    this.batches.push(statements.map((statement) => {
      const fake = statement as FakeStatement
      return { sql: fake.sql, params: fake.params }
    }))
    return statements.map(() => ({ success: true }))
  }
}

class SequentialDb {
  individualRuns = 0
  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this as unknown as FakeDb, query)
  }
}

const aaRows: AaSnapshotRow[] = [
  {
    day: '2026-11-17', slug: 'a/x', name: 'A X', creator: 'A', intelligenceIndex: 90,
    domains: { engineering: 61 }, priceIn: 1, priceOut: 2, releaseDate: '2026-11-01', indexVersion: '3.0',
  },
  {
    day: '2026-11-17', slug: 'b/x', name: 'B X', creator: 'B', intelligenceIndex: 80,
    domains: {}, priceIn: 1, priceOut: 2, releaseDate: '2026-10-30', indexVersion: '3.0',
  },
]

const orRows: OrRankingRow[] = [
  { day: '2026-11-17', permaslug: 'a/x', totalTokens: '600' },
  { day: '2026-11-17', permaslug: 'other', totalTokens: '400' },
  { day: '2026-11-10', permaslug: 'a/x', totalTokens: '500' },
]

describe('Given the D1 metrics store batch replacement', () => {
  it('When AA rows are written Then one batch contains the day delete and all inserts', async () => {
    const db = new FakeDb()
    await new D1MetricsStore(db as unknown as D1DatabaseLike).writeAaSnapshot('2026-11-17', aaRows)
    expect(db.batches).toHaveLength(1)
    expect(db.batches[0]?.[0]?.sql).toContain('DELETE FROM trend_aa_snapshot')
    expect(db.batches[0]?.filter((statement) => statement.sql.includes('INSERT INTO trend_aa_snapshot'))).toHaveLength(2)
    expect(db.individualRuns).toBe(0)
  })

  it('When OR rows are written Then one batch deletes each day and inserts all rows with as_of and meta', async () => {
    const db = new FakeDb()
    await new D1MetricsStore(db as unknown as D1DatabaseLike).writeOrRanking(orRows, '2026-11-17T04:00:00Z', {
      version: 'v1', startDate: '2026-11-04', endDate: '2026-11-17',
    })
    expect(db.batches).toHaveLength(1)
    const statements = db.batches[0] ?? []
    expect(statements.filter((statement) => statement.sql.includes('DELETE FROM trend_or_ranking'))).toHaveLength(2)
    const inserts = statements.filter((statement) => statement.sql.includes('INSERT INTO trend_or_ranking'))
    expect(inserts).toHaveLength(3)
    expect(inserts[0]?.params).toEqual(['2026-11-17', 'a/x', '600', '2026-11-17T04:00:00Z', 'v1', '2026-11-04', '2026-11-17'])
    expect(db.individualRuns).toBe(0)
  })

  it('When the batch fails Then the write rejects and does not fall back to partial sequential runs', async () => {
    const db = new FakeDb()
    db.failBatch = true
    await expect(new D1MetricsStore(db as unknown as D1DatabaseLike).writeAaSnapshot('2026-11-17', aaRows)).rejects.toThrow('batch failed')
    expect(db.individualRuns).toBe(0)
  })

  it('When the database has no batch API Then falls back to sequential execution for test doubles', async () => {
    const db = new SequentialDb()
    await new D1MetricsStore(db as unknown as D1DatabaseLike).writeAaSnapshot('2026-11-17', aaRows)
    expect(db.individualRuns).toBe(3)
  })

  it('When there are no OR rows Then skips the batch instead of calling it with an empty list', async () => {
    const db = new FakeDb()
    await new D1MetricsStore(db as unknown as D1DatabaseLike).writeOrRanking([], '2026-11-17T04:00:00Z', {})
    expect(db.batches).toHaveLength(0)
    expect(db.individualRuns).toBe(0)
  })

  it('When pruning Then both deletes run in one batch', async () => {
    const db = new FakeDb()
    await new D1MetricsStore(db as unknown as D1DatabaseLike).prune('2026-08-19', '2026-09-18')
    expect(db.batches).toHaveLength(1)
    expect(db.batches[0]?.map((statement) => statement.params)).toEqual([['2026-08-19'], ['2026-09-18']])
  })
})
