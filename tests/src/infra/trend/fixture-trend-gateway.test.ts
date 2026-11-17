import { describe, expect, it } from 'vitest'
import type { TrendSection } from '@shared/trend-contract'
import { createFixtureTrendGateway } from '@infra/trend/fixture-trend-gateway'
import { TREND_FIXTURE_SECTIONS } from '@infra/trend/fixture-trend-data'

describe('Given the DEV trend fixture gateway', () => {
  it('When each section is requested Then returns a contract-shaped synthetic payload', async () => {
    const gateway = createFixtureTrendGateway()
    for (const section of Object.keys(TREND_FIXTURE_SECTIONS) as TrendSection[]) {
      const result = await gateway.fetchSection(section)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.value.section).toBe(section)
      expect(result.value.generatedAt).toBe('2026-11-14T03:00:00.000Z')
    }
  })

  it('When the fixture is rendered Then covers metrics, new, free and links without AA', () => {
    const metrics = TREND_FIXTURE_SECTIONS.metrics
    expect(metrics.blocks?.map((block) => block.id)).toEqual(['or-usage'])
    expect(metrics.blocks?.[0]?.entries.length).toBeGreaterThan(0)

    const newest = TREND_FIXTURE_SECTIONS['new-models']
    expect(newest.items.length).toBeGreaterThan(0)
    expect(newest.items.every((item) => item.registeredIn?.includes('openrouter'))).toBe(true)

    const free = TREND_FIXTURE_SECTIONS['free-models']
    expect(new Set(free.items.map((item) => item.freeKind))).toEqual(new Set(['opencode-go']))
    expect(free.items.every((item) => item.free)).toBe(true)

    const plan = TREND_FIXTURE_SECTIONS['plan-models']
    expect(plan.plans?.length).toBeGreaterThan(0)
  })
})
