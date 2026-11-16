import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../shared/usage-history-contract'
import type { UsageHistoryQuery, UsageHistorySummaryEntry } from '../../../shared/usage-history-contract'
import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract'
import { parseCursor } from '../../domain/usage/history-query'
import type { HistoryResult, HistoryRow, HistoryStore } from '../../domain/usage/history-store'

/** Structural D1 binding surface used by tests and the Worker runtime. */
export interface D1Result<T> {
  results: T[]
  success?: boolean
}
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run(): Promise<unknown>
}
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

interface D1EventRow {
  id: string
  run_at_ms: number
  status: UsageStatus
  envelope: string
}

interface D1SummaryRow {
  provider: UsageProvider
  ok_count: number | string
  first_ok_ms: number | null
  last_ok_ms: number | null
}

function eventRow(row: D1EventRow): HistoryRow {
  const envelope = JSON.parse(row.envelope) as Record<string, unknown>
  const fetchedAt = typeof envelope.fetchedAt === 'string' ? envelope.fetchedAt : null
  const intervalSec = typeof envelope.intervalSec === 'number' ? String(envelope.intervalSec) : null
  return {
    id: String(row.id),
    runAt: new Date(Number(row.run_at_ms)).toISOString(),
    status: row.status,
    fetchedAt,
    intervalSec,
    rawText: row.status === 'ok' && typeof envelope.rawText === 'string' ? envelope.rawText : null,
    rawRedacted: row.status === 'ok' ? envelope.rawRedacted ?? null : null,
  }
}

async function all<T>(db: D1DatabaseLike, query: string, params: readonly unknown[]): Promise<T[]> {
  const result = await db.prepare(query).bind(...params).all<T>()
  if (result.success === false) throw new Error('D1 statement failed')
  return result.results
}

const EVENT_COLUMNS = 'CAST(e.id AS TEXT) AS id, e.run_at AS run_at_ms, e.status, e.envelope'

/** Read-only D1 history adapter. The flag is intentionally not wired to the Worker in A. */
export class D1HistoryStore implements HistoryStore {
  constructor(private readonly db: D1DatabaseLike | null) {}

  async readRows(provider: UsageProvider, query: UsageHistoryQuery): Promise<HistoryResult<HistoryRow[]>> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const params: unknown[] = [provider]
      let where = 'e.provider = ?'
      if (query.from !== undefined) {
        where += ' AND e.run_at >= ?'
        params.push(Date.parse(query.from))
      }
      if (query.until !== undefined) {
        where += ' AND e.run_at < ?'
        params.push(Date.parse(query.until))
      }
      const cursor = query.after === undefined ? null : parseCursor(query.after)
      if (cursor !== null) {
        where += ' AND (e.run_at > ? OR (e.run_at = ? AND e.id > CAST(? AS INTEGER)))'
        const runAtMs = Date.parse(cursor.runAt)
        params.push(runAtMs, runAtMs, cursor.id)
      }
      params.push(query.limit)
      const rows = await all<D1EventRow>(this.db, `SELECT ${EVENT_COLUMNS} FROM usage_event AS e WHERE ${where} ORDER BY e.run_at ASC, e.id ASC LIMIT ?`, params)
      return { ok: true, value: rows.map(eventRow) }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }

  async readAnchorRow(provider: UsageProvider, from: string): Promise<HistoryResult<HistoryRow | null>> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const rows = await all<D1EventRow>(
        this.db,
        `SELECT ${EVENT_COLUMNS} FROM usage_event AS e WHERE e.provider = ? AND e.status = 'ok' AND e.run_at < ? ORDER BY e.run_at DESC, e.id DESC LIMIT 1`,
        [provider, Date.parse(from)],
      )
      return { ok: true, value: rows[0] === undefined ? null : eventRow(rows[0]) }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }

  async readRowBefore(provider: UsageProvider, before: string): Promise<HistoryResult<HistoryRow | null>> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const rows = await all<D1EventRow>(
        this.db,
        `SELECT ${EVENT_COLUMNS} FROM usage_event AS e WHERE e.provider = ? AND e.run_at < ? ORDER BY e.run_at DESC, e.id DESC LIMIT 1`,
        [provider, Date.parse(before)],
      )
      return { ok: true, value: rows[0] === undefined ? null : eventRow(rows[0]) }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }

  async readSummary(providers: readonly UsageProvider[]): Promise<HistoryResult<UsageHistorySummaryEntry[]>> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const rows = await all<D1SummaryRow>(
        this.db,
        `SELECT provider,
                count(CASE WHEN status = 'ok' THEN 1 END) AS ok_count,
                min(CASE WHEN status = 'ok' THEN run_at END) AS first_ok_ms,
                max(CASE WHEN status = 'ok' THEN run_at END) AS last_ok_ms
           FROM usage_event
          GROUP BY provider`,
        [],
      )
      const byProvider = new Map(rows.map(row => [row.provider, row]))
      return {
        ok: true,
        value: providers.map((provider) => {
          const row = byProvider.get(provider)
          return {
            provider,
            okCount: Math.min(USAGE_HISTORY_MIN_OK_EVENTS, Number(row?.ok_count ?? 0)),
            firstOkAt: row?.first_ok_ms == null ? null : new Date(Number(row.first_ok_ms)).toISOString(),
            lastOkAt: row?.last_ok_ms == null ? null : new Date(Number(row.last_ok_ms)).toISOString(),
          }
        }),
      }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }
}
