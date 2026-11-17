import { TREND_SECTION_STALE_MS } from '../../../shared/trend-contract'
import type { TrendIndex, TrendIndexSection, TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import { projectSectionPayload } from '../../domain/trend/projection'
import { sectionStateSourceId } from '../../domain/trend/store'
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

export async function getTrendIndex(store: TrendStore, nowMs = Date.now()): Promise<TrendIndex | null> {
  const rows = await store.readSections()
  let sourceStates: Awaited<ReturnType<NonNullable<TrendStore['readSourceStates']>>> = []
  try {
    if (store.readSourceStates !== undefined) sourceStates = await store.readSourceStates()
  } catch {
    sourceStates = []
  }
  const bySource = new Map(sourceStates.map((row) => [row.source, row.fetchedAt]))
  const sections: TrendIndexSection[] = []
  let generatedAt = 0
  for (const row of rows) {
    const payload = parsePayload(row)
    if (payload === null) continue
    const at = Date.parse(payload.generatedAt)
    if (Number.isFinite(at)) generatedAt = Math.max(generatedAt, at)
    const checkedMs = bySource.get(sectionStateSourceId(row.section))
    const hasChecked = checkedMs !== undefined && checkedMs > 0
    const staleByAge = !hasChecked || nowMs - checkedMs > TREND_SECTION_STALE_MS[row.section]
    const hasStaleSource = payload.sources.some((source) => source.status === 'stale')
    sections.push({
      id: row.section,
      // metrics는 items가 비어 있고 blocks.entries가 실질 항목이다.
      count: payload.items.length + (payload.blocks?.reduce((total, block) => total + block.entries.length, 0) ?? 0),
      generatedAt: payload.generatedAt,
      ...(hasChecked ? { checkedAt: new Date(checkedMs).toISOString() } : {}),
      status: hasStaleSource || staleByAge ? 'stale' : 'ok',
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
