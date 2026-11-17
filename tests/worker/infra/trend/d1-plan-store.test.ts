import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../worker/infra/usage/d1-history-store'
import { D1PlanStore } from '../../../../worker/infra/trend/d1-plan-store'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)

interface Recorded {
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
    return { results: this.db.rows as T[], success: true }
  }
  async run(): Promise<unknown> {
    this.db.runs += 1
    return {}
  }
}

class FakeDb {
  batches: Recorded[][] = []
  runs = 0
  rows: unknown[] = []
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

describe('Given the D1 plan observation store', () => {
  it('When a large initial set and a later update are saved Then baseline and first seen stay intact', async () => {
    const sqlite = new DatabaseSync(':memory:')
    sqlite.exec(readFileSync('worker/migrations/0003-trend-plan-observation.sql', 'utf8'))
    const db = {
      prepare(sql: string) { return { bind(...params: unknown[]) { return { async run() { sqlite.prepare(sql).run(...params as (string | number | null)[]); return { success: true } } } } } },
      async batch(statements: { run(): Promise<unknown> }[]) { return Promise.all(statements.map((s) => s.run())) },
    }
    const store = new D1PlanStore(db as unknown as D1DatabaseLike)
    const observations = Array.from({ length: 61 }, (_, i) => ({ plan: 'opencode-go', modelId: `model-${i}`, displayName: null, source: 'go-models', confidence: 'catalog' as const }))
    await store.upsertObservations('opencode-go', 'go-models', observations, NOW)
    await store.upsertObservations('opencode-go', 'go-models', [observations[0]!, observations[0]!, { ...observations[0]!, modelId: 'new' }], NOW + 1)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM trend_plan_observation WHERE baseline = 1').get()?.n).toBe(61)
    expect(sqlite.prepare('SELECT first_seen_at, last_seen_at, baseline FROM trend_plan_observation WHERE model_id = ?').get('model-0')).toMatchObject({ first_seen_at: NOW, last_seen_at: NOW + 1, baseline: 1 })
    expect(sqlite.prepare('SELECT baseline FROM trend_plan_observation WHERE model_id = ?').get('new')?.baseline).toBe(0)
    sqlite.close()
  })
  it('When 61 observations are upserted Then the statement stays within D1 binding limits', async () => {
    const db = new FakeDb()
    const observations = Array.from({ length: 61 }, (_, i) => ({ plan: 'opencode-go', modelId: `model-${i}`, displayName: null, source: 'go-models', confidence: 'catalog' as const }))
    await new D1PlanStore(db as unknown as D1DatabaseLike).upsertObservations('opencode-go', 'go-models', observations, NOW)
    expect(db.batches[0]).toHaveLength(1)
    expect(db.batches[0]![0]!.params.length).toBeLessThanOrEqual(100)
  })
  it('When public source observations are upserted Then one baseline-aware batch runs', async () => {
    const db = new FakeDb()
    await new D1PlanStore(db as unknown as D1DatabaseLike).upsertObservations('opencode-go', 'go-models', [
      { plan: 'opencode-go', modelId: 'a/x', displayName: 'A X', source: 'go-models', confidence: 'catalog' },
      { plan: 'opencode-go', modelId: 'b/x', displayName: 'B X', source: 'go-models', confidence: 'catalog' },
    ], NOW)
    expect(db.batches).toHaveLength(1)
    const statement = db.batches[0]?.[0]
    expect(statement?.sql).toContain('WITH initial AS MATERIALIZED')
    expect(statement?.sql).toContain('ON CONFLICT(plan, model_id) DO UPDATE SET last_seen_at = excluded.last_seen_at')
    expect(statement?.params).toEqual([
      'opencode-go', 'opencode-go', 'go-models', NOW, NOW,
      JSON.stringify([['a/x', 'A X', 'catalog'], ['b/x', 'B X', 'catalog']]),
    ])
    expect(db.runs).toBe(0)
  })

  it('When there are no observations Then skips the batch', async () => {
    const db = new FakeDb()
    await new D1PlanStore(db as unknown as D1DatabaseLike).upsertObservations('opencode-go', 'go-models', [], NOW)
    expect(db.batches).toHaveLength(0)
  })

  it('When the batch fails Then the upsert rejects without sequential partial writes', async () => {
    const db = new FakeDb()
    db.failBatch = true
    await expect(new D1PlanStore(db as unknown as D1DatabaseLike).upsertObservations('opencode-go', 'go-models', [
      { plan: 'opencode-go', modelId: 'a/x', displayName: 'A X', source: 'go-models', confidence: 'catalog' },
    ], NOW)).rejects.toThrow('batch failed')
    expect(db.runs).toBe(0)
  })

  it('When observations are read Then maps rows and filters unknown confidence to catalog', async () => {
    const db = new FakeDb()
    db.rows = [
      { plan: 'claude-max', model_id: 'claude-display:x', display_name: 'X', source: 'usage-keys', confidence: 'partial', first_seen_at: NOW - 1, last_seen_at: NOW, baseline: 0 },
      { plan: 'grok', model_id: 'grok-4.7', display_name: null, source: 'grok-build-models', confidence: 'unknown', first_seen_at: NOW - 2, last_seen_at: NOW, baseline: 1 },
    ]
    const rows = await new D1PlanStore(db as unknown as D1DatabaseLike).readObservations()
    expect(rows).toEqual([
      expect.objectContaining({ plan: 'claude-max', modelId: 'claude-display:x', confidence: 'partial', baseline: false }),
      expect.objectContaining({ plan: 'grok', modelId: 'grok-4.7', confidence: 'catalog', baseline: true }),
    ])
  })
})
