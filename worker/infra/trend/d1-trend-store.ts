import { TREND_SECTION_MAX_BYTES } from '../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import type { PlanObservationRow } from '../../domain/trend/plan/types'
import type { D1DatabaseLike } from '../usage/d1-history-store'
import type { TrendSectionRow, TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../domain/trend/store'

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface SectionDbRow {
  section: string
  payload: string
  payload_sha256: string
  generated_at: number
}
interface SourceDbRow {
  source: string
  etag: string | null
  fetched_at: number
  ok: number
  http_status: number | null
}
interface SeenDbRow {
  canonical_id: string
  first_seen_at: number
  release_date: string | null
  source: string
}
interface PlanObservationDbRow {
  plan: string
  model_id: string
  display_name: string | null
  source: string
  confidence: string
  first_seen_at: number
  last_seen_at: number
  baseline: number
}

export class D1TrendStore implements TrendStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async readSection(section: TrendSection): Promise<TrendSectionRow | null> {
    const rows = await all<SectionDbRow>(this.db, 'SELECT section, payload, payload_sha256, generated_at FROM trend_section WHERE section = ?', [section])
    const row = rows[0]
    return row === undefined ? null : { section: row.section as TrendSection, payload: row.payload, payloadSha256: row.payload_sha256, generatedAt: Number(row.generated_at) }
  }

  async readSections(): Promise<TrendSectionRow[]> {
    const rows = await all<SectionDbRow>(this.db, 'SELECT section, payload, payload_sha256, generated_at FROM trend_section ORDER BY section ASC', [])
    return rows.map((row) => ({ section: row.section as TrendSection, payload: row.payload, payloadSha256: row.payload_sha256, generatedAt: Number(row.generated_at) }))
  }

  async writeSection(payload: TrendSectionPayload): Promise<string> {
    const text = JSON.stringify(payload)
    if (new TextEncoder().encode(text).length > TREND_SECTION_MAX_BYTES) throw new Error('trend_section_too_large')
    const sha = await sha256Hex(text)
    await this.db.prepare(
      `INSERT INTO trend_section (section, schema_version, generated_at, payload, payload_sha256)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(section) DO UPDATE SET
         schema_version = excluded.schema_version,
         generated_at = excluded.generated_at,
         payload = excluded.payload,
         payload_sha256 = excluded.payload_sha256`,
    ).bind(payload.section, payload.schemaVersion, Date.parse(payload.generatedAt), text, sha).run()
    return sha
  }

  async readSourceState(source: string): Promise<TrendSourceStateRow | null> {
    const rows = await all<SourceDbRow>(this.db, 'SELECT source, etag, fetched_at, ok, http_status FROM trend_source_state WHERE source = ?', [source])
    const row = rows[0]
    return row === undefined ? null : { source: row.source, etag: row.etag, fetchedAt: Number(row.fetched_at), ok: row.ok === 1, httpStatus: row.http_status === null ? null : Number(row.http_status) }
  }

  async writeSourceState(row: TrendSourceStateRow): Promise<void> {
    await this.db.prepare(
      `INSERT INTO trend_source_state (source, etag, fetched_at, ok, http_status)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         etag = excluded.etag, fetched_at = excluded.fetched_at, ok = excluded.ok, http_status = excluded.http_status`,
    ).bind(row.source, row.etag, row.fetchedAt, row.ok ? 1 : 0, row.httpStatus).run()
  }

  async readSeen(): Promise<TrendSeenRow[]> {
    const rows = await all<SeenDbRow>(this.db, 'SELECT canonical_id, first_seen_at, release_date, source FROM trend_model_seen', [])
    return rows.map((row) => ({ canonicalId: row.canonical_id, firstSeenAt: Number(row.first_seen_at), releaseDate: row.release_date, source: row.source }))
  }

  async readPlanObservations(): Promise<PlanObservationRow[]> {
    const rows = await all<PlanObservationDbRow>(
      this.db,
      'SELECT plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline FROM trend_plan_observation ORDER BY plan ASC, first_seen_at DESC',
      [],
    )
    return rows.map((row) => ({
      plan: row.plan,
      modelId: row.model_id,
      displayName: row.display_name,
      source: row.source,
      confidence: row.confidence === 'account' || row.confidence === 'doc' || row.confidence === 'partial' ? row.confidence : 'catalog',
      firstSeenAt: Number(row.first_seen_at),
      lastSeenAt: Number(row.last_seen_at),
      baseline: row.baseline === 1,
    }))
  }

  async upsertSeen(rows: readonly TrendSeenRow[]): Promise<void> {
    for (const row of rows) {
      await this.db.prepare(
        `INSERT INTO trend_model_seen (canonical_id, first_seen_at, release_date, source)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(canonical_id) DO NOTHING`,
      ).bind(row.canonicalId, row.firstSeenAt, row.releaseDate, row.source).run()
    }
  }
}
