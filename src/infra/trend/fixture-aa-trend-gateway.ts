import type { AaTrendGateway } from '@domain/trend/aa-gateway'
import type { AaTrendModelItem, AaTrendResponse } from '@shared/trend-contract'

/** DEV 전용 명백한 합성 AA 표본(?fixture=normal). 실제 AA 수치·모델 조합을 쓰지 않는다. */
const FIXTURE_BASE: Omit<AaTrendModelItem, 'costPerTask'>[] = [
  { slug: 'fixture-alpha-1', name: 'Fixture Alpha 1', creator: 'Synthetic Lab', intelligenceIndex: 90.0, priceIn: 10.0, priceOut: 30.0, outputTokensPerSecond: 100.0, timeToFirstTokenSeconds: 1.0, releaseDate: '2026-11-01' },
  { slug: 'fixture-beta-2', name: 'Fixture Beta 2', creator: 'Synthetic Lab', intelligenceIndex: 88.0, priceIn: 8.0, priceOut: 24.0, outputTokensPerSecond: 120.0, timeToFirstTokenSeconds: 0.9, releaseDate: '2026-11-02' },
  { slug: 'fixture-gamma-3', name: 'Fixture Gamma 3', creator: 'Demo Org', intelligenceIndex: 86.0, priceIn: 6.0, priceOut: 18.0, outputTokensPerSecond: 140.0, timeToFirstTokenSeconds: 0.8, releaseDate: '2026-11-03' },
  { slug: 'fixture-delta-4', name: 'Fixture Delta 4', creator: 'Demo Org', intelligenceIndex: 84.0, priceIn: 5.0, priceOut: 15.0, outputTokensPerSecond: 160.0, timeToFirstTokenSeconds: 0.7, releaseDate: '2026-11-04' },
  { slug: 'fixture-epsilon-5', name: 'Fixture Epsilon 5', creator: 'Sample AI', intelligenceIndex: 82.0, priceIn: 4.0, priceOut: 12.0, outputTokensPerSecond: 180.0, timeToFirstTokenSeconds: 0.6, releaseDate: '2026-11-05' },
  { slug: 'fixture-zeta-6', name: 'Fixture Zeta 6', creator: 'Sample AI', intelligenceIndex: 80.0, priceIn: 3.0, priceOut: 9.0, outputTokensPerSecond: 200.0, timeToFirstTokenSeconds: 0.5, releaseDate: '2026-11-06' },
  { slug: 'fixture-eta-7', name: 'Fixture Eta 7', creator: 'Mock Works', intelligenceIndex: 78.0, priceIn: 2.0, priceOut: 6.0, outputTokensPerSecond: 220.0, timeToFirstTokenSeconds: 0.45, releaseDate: '2026-11-07' },
  { slug: 'fixture-theta-8', name: 'Fixture Theta 8', creator: 'Mock Works', intelligenceIndex: 76.0, priceIn: 1.5, priceOut: 4.5, outputTokensPerSecond: 240.0, timeToFirstTokenSeconds: 0.4, releaseDate: '2026-11-08' },
  { slug: 'fixture-iota-9', name: 'Fixture Iota 9', creator: 'Test Studio', intelligenceIndex: 74.0, priceIn: 1.0, priceOut: 3.0, outputTokensPerSecond: 260.0, timeToFirstTokenSeconds: 0.35, releaseDate: '2026-11-09' },
  { slug: 'fixture-kappa-10', name: 'Fixture Kappa 10', creator: 'Test Studio', intelligenceIndex: 72.0, priceIn: 0.5, priceOut: 1.5, outputTokensPerSecond: 280.0, timeToFirstTokenSeconds: 0.3, releaseDate: '2026-11-10' },
  { slug: 'fixture-lambda-11', name: 'Fixture Lambda 11', creator: 'Fixture Co', intelligenceIndex: 70.0, priceIn: 0.25, priceOut: 0.75, outputTokensPerSecond: 300.0, timeToFirstTokenSeconds: 0.25, releaseDate: '2026-11-11' },
  { slug: 'fixture-mu-12', name: 'Fixture Mu 12', creator: 'Fixture Co', intelligenceIndex: 68.0, priceIn: 0.1, priceOut: 0.3, outputTokensPerSecond: 320.0, timeToFirstTokenSeconds: 0.2, releaseDate: '2026-11-12' },
]

const FIXTURE_ITEMS: AaTrendModelItem[] = FIXTURE_BASE.map((item, index) => ({
  ...item,
  costPerTask: Number((0.05 + index * 0.05).toFixed(2)),
}))

export const AA_TREND_FIXTURE: AaTrendResponse = {
  day: '2026-11-14',
  indexVersion: '5.0',
  attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
  intelligenceTop: [...FIXTURE_ITEMS].sort((a, b) => b.intelligenceIndex - a.intelligenceIndex).slice(0, 20),
  priceLowest: [...FIXTURE_ITEMS].sort((a, b) => (a.priceOut ?? 0) - (b.priceOut ?? 0)).slice(0, 10),
  costLowest: [...FIXTURE_ITEMS].sort((a, b) => (a.costPerTask ?? 0) - (b.costPerTask ?? 0)).slice(0, 20),
  speedHighest: [...FIXTURE_ITEMS].sort((a, b) => (b.outputTokensPerSecond ?? 0) - (a.outputTokensPerSecond ?? 0)).slice(0, 10),
  latencyLowest: [...FIXTURE_ITEMS].sort((a, b) => (a.timeToFirstTokenSeconds ?? 0) - (b.timeToFirstTokenSeconds ?? 0)).slice(0, 10),
}

export function createFixtureAaTrendGateway(): AaTrendGateway {
  return {
    async fetchAaTrend() {
      return { ok: true, value: AA_TREND_FIXTURE }
    },
  }
}
