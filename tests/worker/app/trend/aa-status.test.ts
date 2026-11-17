import { describe, expect, it } from 'vitest'
import { aaStatusToken, refreshMetrics } from '../../../../worker/app/trend/refresh-metrics'
import type { AaFetchResult, AaSource, MetricsStore, OrRankingSource } from '../../../../worker/domain/trend/metrics/types'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import type { TrendSectionRow } from '../../../../worker/domain/trend/store'

const NOW = Date.parse('2026-11-17T05:00:00.000Z')
class Store implements MetricsStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  async readSection(section: TrendSection) { return this.sections.get(section) ?? null }
  async writeSection(payload: TrendSectionPayload) {
    this.sections.set(payload.section, { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readAaSnapshot() { return [] }
  async writeAaSnapshot() {}
  async readOrRanking() { return [] }
  async writeOrRanking() {}
  async prune() {}
}
const aaSource = (result: AaFetchResult): AaSource => ({ id: 'artificial-analysis', async fetch() { return result } })
const orSource: OrRankingSource = { id: 'openrouter-rankings', async fetch() { return { ok: false, reason: 'unauthorized', httpStatus: 401 } } }

describe('Given the AA dry-run diagnostics', () => {
  it.each([
    [{ status: 'ok' as const, reason: null }, 'ok'],
    [{ status: 'not_configured' as const, reason: 'not_configured' as const }, 'not_configured'],
    [{ status: 'stale' as const, reason: 'unauthorized' as const }, 'unauthorized'],
    [{ status: 'stale' as const, reason: 'invalid' as const }, 'invalid'],
    [{ status: 'stale' as const, reason: 'rejected' as const }, 'rejected'],
    [{ status: 'stale' as const, reason: 'storage' as const }, 'storage'],
  ])('When aa is %o Then the fixed token is %s', (aa, token) => {
    expect(aaStatusToken(aa)).toBe(token)
  })

  it('When a real AA snapshot yields a citation Then the refresh result carries it', async () => {
    const store = new Store()
    const result = await refreshMetrics({
      store, nowMs: NOW, orSource,
      aaSource: aaSource({
        ok: true,
        snapshot: { version: '5', entries: [{ slug: 'a', name: 'Model A (high)', creator: '', releaseDate: null, intelligenceIndex: 92, priceIn: null, priceOut: null, domains: {} }] },
      }),
    })
    expect(result.aaCitation).toBe('Artificial Analysis Intelligence Index 1위는 Model A (high) (92)입니다. (2026-11-17 기준)')
    expect(aaStatusToken(result.aa)).toBe('ok')
  })

  it('When the citation is rejected Then the result carries the rejected token', async () => {
    const store = new Store()
    const result = await refreshMetrics({
      store, nowMs: NOW, orSource,
      aaSource: aaSource({
        ok: true,
        snapshot: { version: '5', entries: [{ slug: 'a', name: '[{serialized}]', creator: '', releaseDate: null, intelligenceIndex: 92, priceIn: null, priceOut: null, domains: {} }] },
      }),
    })
    expect(aaStatusToken(result.aa)).toBe('rejected')
    expect(result.aaCitation).toBeUndefined()
  })
})
