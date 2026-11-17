import type { TrendIndex, TrendIndexSection, TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import type { TrendSectionRow, TrendStore } from '../../domain/trend/store'

function parsePayload(row: TrendSectionRow): TrendSectionPayload | null {
  try {
    const value: unknown = JSON.parse(row.payload)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as TrendSectionPayload
    return payload.section === row.section && Array.isArray(payload.items) && Array.isArray(payload.sources) ? payload : null
  } catch {
    return null
  }
}

export async function getTrendIndex(store: TrendStore): Promise<TrendIndex | null> {
  const rows = await store.readSections()
  const sections: TrendIndexSection[] = []
  let generatedAt = 0
  for (const row of rows) {
    const payload = parsePayload(row)
    if (payload === null) continue
    const at = Date.parse(payload.generatedAt)
    if (Number.isFinite(at)) generatedAt = Math.max(generatedAt, at)
    sections.push({
      id: row.section,
      count: payload.items.length,
      generatedAt: payload.generatedAt,
      status: payload.sources.some((source) => source.status === 'stale') ? 'stale' : 'ok',
    })
  }
  if (sections.length === 0) return null
  return { generatedAt: new Date(generatedAt).toISOString(), sections }
}

export async function getTrendSection(store: TrendStore, section: TrendSection): Promise<{ ok: true; row: TrendSectionRow } | { ok: false; reason: 'not_ready' }> {
  const row = await store.readSection(section)
  return row === null ? { ok: false, reason: 'not_ready' } : { ok: true, row }
}
