import type { TrendIndex, TrendIndexSection, TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import { projectSectionPayload } from '../../domain/trend/projection'
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

export async function getPublicTrendSection(
  store: TrendStore,
  section: TrendSection,
): Promise<{ ok: true; payload: TrendSectionPayload } | { ok: false; reason: 'not_ready' | 'corrupt' }> {
  const row = await store.readSection(section)
  if (row === null) return { ok: false, reason: 'not_ready' }
  let parsed: unknown
  try {
    parsed = JSON.parse(row.payload)
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
  const payload = projectSectionPayload(parsed, section)
  if (payload === null) return { ok: false, reason: 'corrupt' }
  if (section === 'metrics' && payload.blocks !== undefined) {
    // AA 데이터는 공개 재배포가 불가하므로 저장 payload에 남아 있어도 공개하지 않는다.
    return { ok: true, payload: { ...payload, blocks: payload.blocks.filter((block) => block.id === 'or-usage') } }
  }
  return { ok: true, payload }
}
