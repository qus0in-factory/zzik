import { D1TrendStore } from './d1-trend-store'
import type { D1DatabaseLike } from '../usage/d1-history-store'
import type { AaSnapshotRow, MetricsStore, OrRankingRow } from '../../domain/trend/metrics/types'

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

interface AaDbRow {
  day: string
  slug: string
  name: string
  creator: string
  intelligence_index: number
  domain_json: string
  price_in: number | null
  price_out: number | null
  release_date: string | null
  index_version: string
}
interface OrDbRow {
  day: string
  model_permaslug: string
  total_tokens: string
}

function parseDomains(text: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const domains: Record<string, number> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) domains[key] = entry
    }
    return domains
  } catch {
    return {}
  }
}

/** #116 metrics 스냅샷 저장소. 일 단위로 교체하고 보존 기간이 지난 행을 지운다. */
export class D1MetricsStore implements MetricsStore {
  private readonly sections: D1TrendStore

  constructor(private readonly db: D1DatabaseLike) {
    this.sections = new D1TrendStore(db)
  }

  readSection(section: Parameters<D1TrendStore['readSection']>[0]) {
    return this.sections.readSection(section)
  }

  writeSection(payload: Parameters<D1TrendStore['writeSection']>[0]) {
    return this.sections.writeSection(payload)
  }

  async readAaSnapshot(day: string): Promise<AaSnapshotRow[]> {
    const rows = await all<AaDbRow>(
      this.db,
      'SELECT day, slug, name, creator, intelligence_index, domain_json, price_in, price_out, release_date, index_version FROM trend_aa_snapshot WHERE day = ?',
      [day],
    )
    return rows.map((row) => ({
      day: row.day,
      slug: row.slug,
      name: row.name,
      creator: row.creator,
      intelligenceIndex: Number(row.intelligence_index),
      domains: parseDomains(row.domain_json),
      priceIn: row.price_in === null ? null : Number(row.price_in),
      priceOut: row.price_out === null ? null : Number(row.price_out),
      releaseDate: row.release_date,
      indexVersion: row.index_version,
    }))
  }

  async writeAaSnapshot(day: string, rows: readonly AaSnapshotRow[]): Promise<void> {
    await this.db.prepare('DELETE FROM trend_aa_snapshot WHERE day = ?').bind(day).run()
    for (const row of rows) {
      await this.db.prepare(
        `INSERT INTO trend_aa_snapshot (day, slug, name, creator, intelligence_index, domain_json, price_in, price_out, release_date, index_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, slug) DO UPDATE SET
           name = excluded.name, creator = excluded.creator,
           intelligence_index = excluded.intelligence_index, domain_json = excluded.domain_json,
           price_in = excluded.price_in, price_out = excluded.price_out,
           release_date = excluded.release_date, index_version = excluded.index_version`,
      ).bind(
        row.day, row.slug, row.name, row.creator, row.intelligenceIndex, JSON.stringify(row.domains),
        row.priceIn, row.priceOut, row.releaseDate, row.indexVersion,
      ).run()
    }
  }

  async readOrRanking(fromDay: string, toDay: string): Promise<OrRankingRow[]> {
    const rows = await all<OrDbRow>(
      this.db,
      'SELECT day, model_permaslug, total_tokens FROM trend_or_ranking WHERE day BETWEEN ? AND ?',
      [fromDay, toDay],
    )
    return rows.map((row) => ({ day: row.day, permaslug: row.model_permaslug, totalTokens: row.total_tokens }))
  }

  async writeOrRanking(rows: readonly OrRankingRow[], asOf: string): Promise<void> {
    const days = [...new Set(rows.map((row) => row.day))].sort()
    for (const day of days) {
      await this.db.prepare('DELETE FROM trend_or_ranking WHERE day = ?').bind(day).run()
    }
    for (const row of rows) {
      await this.db.prepare(
        `INSERT INTO trend_or_ranking (day, model_permaslug, total_tokens, as_of)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(day, model_permaslug) DO UPDATE SET
           total_tokens = excluded.total_tokens, as_of = excluded.as_of`,
      ).bind(row.day, row.permaslug, row.totalTokens, asOf).run()
    }
  }

  async prune(beforeAaDay: string, beforeOrDay: string): Promise<void> {
    await this.db.prepare('DELETE FROM trend_aa_snapshot WHERE day < ?').bind(beforeAaDay).run()
    await this.db.prepare('DELETE FROM trend_or_ranking WHERE day < ?').bind(beforeOrDay).run()
  }
}
