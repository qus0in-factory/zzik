import type { TrendPlanConfidence, TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import type { D1DatabaseLike, D1PreparedStatementLike } from '../usage/d1-history-store'
import { D1TrendStore, writeTrendSourceState } from './d1-trend-store'
import type { TrendSourceStateRow } from '../../domain/trend/store'
import type { PlanObservation, PlanObservationRow, PlanStore } from '../../domain/trend/plan/types'

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

interface D1BatchDatabaseLike extends D1DatabaseLike {
  batch?(statements: D1PreparedStatementLike[]): Promise<Array<{ success?: boolean }>>
}

async function runStatements(db: D1DatabaseLike, statements: D1PreparedStatementLike[]): Promise<void> {
  if (statements.length === 0) return
  const batch = (db as D1BatchDatabaseLike).batch
  if (batch !== undefined) {
    const results = await batch.call(db, statements)
    if (results.some((result) => result.success === false)) throw new Error('D1 batch failed')
    return
  }
  for (const statement of statements) await statement.run()
}

interface ObservationDbRow {
  plan: string
  model_id: string
  display_name: string | null
  source: string
  confidence: string
  first_seen_at: number
  last_seen_at: number
  baseline: number
}

const CONFIDENCE: readonly TrendPlanConfidence[] = ['account', 'catalog', 'doc', 'partial']

function confidenceOf(value: string): TrendPlanConfidence {
  return (CONFIDENCE as readonly string[]).includes(value) ? value as TrendPlanConfidence : 'catalog'
}

/** #116 plan-models 관측 저장소. 0003 테이블을 그대로 쓰고 섹션은 trend_section에 둔다. */
export class D1PlanStore implements PlanStore {
  private readonly sections: D1TrendStore

  constructor(private readonly db: D1DatabaseLike) {
    this.sections = new D1TrendStore(db)
  }

  readSection(section: TrendSection) {
    return this.sections.readSection(section)
  }

  writeSection(payload: TrendSectionPayload) {
    return this.sections.writeSection(payload)
  }

  async readObservations(): Promise<PlanObservationRow[]> {
    const rows = await all<ObservationDbRow>(
      this.db,
      'SELECT plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline FROM trend_plan_observation ORDER BY plan ASC, first_seen_at DESC',
      [],
    )
    return rows.map((row) => ({
      plan: row.plan,
      modelId: row.model_id,
      displayName: row.display_name,
      source: row.source,
      confidence: confidenceOf(row.confidence),
      firstSeenAt: Number(row.first_seen_at),
      lastSeenAt: Number(row.last_seen_at),
      baseline: row.baseline === 1,
    }))
  }

  async upsertObservations(
    plan: string,
    source: string,
    observations: readonly PlanObservation[],
    nowMs: number,
  ): Promise<void> {
    if (observations.length === 0) return
    const rows = JSON.stringify(observations.map(({ modelId, displayName, confidence }) => [modelId, displayName, confidence]))
    if (new TextEncoder().encode(rows).length > 2_000_000) throw new Error('plan_observations_too_large')
    const params: unknown[] = [plan, plan, source, nowMs, nowMs, rows]
    const statement = this.db.prepare(
      `WITH initial AS MATERIALIZED (SELECT NOT EXISTS (SELECT 1 FROM trend_plan_observation WHERE plan = ?) AS baseline)
       INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline)
       SELECT ?, json_extract(models.value, '$[0]'), json_extract(models.value, '$[1]'), ?, json_extract(models.value, '$[2]'), ?, ?, initial.baseline
       FROM json_each(?) AS models
       CROSS JOIN initial
       WHERE true
       ON CONFLICT(plan, model_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    ).bind(...params)
    await runStatements(this.db, [statement])
  }

  async writeSourceState(row: TrendSourceStateRow): Promise<void> {
    await writeTrendSourceState(this.db, row)
  }
}
