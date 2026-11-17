import {
  TREND_OR_LICENSE_NAME,
  TREND_OR_LICENSE_URL,
  TREND_OR_MOVE_RANK_MAX,
  TREND_OR_SHARE_DELTA,
  TREND_OR_TOP_N,
} from '../../../../shared/trend-contract'
import type { TrendMetricsBlock, TrendMetricsEntry, TrendMetricsMeta } from '../../../../shared/trend-contract'
import { addDays } from './types'
import type { OrRankingMeta, OrRankingRow } from './types'

interface Aggregate {
  tokens: Map<string, bigint>
  total: bigint
}

function aggregate(rows: readonly OrRankingRow[], fromDay: string, toDay: string): Aggregate {
  const tokens = new Map<string, bigint>()
  let total = 0n
  for (const row of rows) {
    if (row.day < fromDay || row.day > toDay) continue
    let value: bigint
    try {
      value = BigInt(row.totalTokens)
    } catch {
      continue
    }
    total += value
    tokens.set(row.permaslug, (tokens.get(row.permaslug) ?? 0n) + value)
  }
  return { tokens, total }
}

function rankTokens(tokens: Map<string, bigint>): Map<string, number> {
  const ranked = [...tokens.entries()]
    .filter(([permaslug, value]) => permaslug !== 'other' && value > 0n)
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1))
  return new Map(ranked.map(([permaslug], index) => [permaslug, index + 1]))
}

/** BigInt 비율을 정밀도 6자리로 계산한다(토큰 절대값을 Number로 바꾸지 않는다). */
function ratio(value: bigint, total: bigint): number {
  if (total <= 0n) return 0
  return Number((value * 1_000_000n) / total) / 1_000_000
}

function round6(value: number): number {
  return Number(value.toFixed(6))
}

export function orAttribution(asOf: string): string {
  return `Source: OpenRouter (openrouter.ai/rankings), as of ${asOf}. Licensed under CC BY 4.0.`
}

/**
 * OpenRouter 일별 상위 50 토큰 합으로 최근 7일과 직전 7일의 점유율·순위를 비교한다.
 * 토큰 절대값은 공급자별 토크나이저가 달라 공개하지 않고 점유율·변동만 낸다.
 */
export function buildOrBlock(input: {
  rows: readonly OrRankingRow[]
  today: string
  asOf: string
  asOfKind: 'source' | 'fetched'
  meta: OrRankingMeta
}): TrendMetricsBlock {
  const currentFrom = addDays(input.today, -6)
  const previousFrom = addDays(input.today, -13)
  const previousTo = addDays(input.today, -7)
  const current = aggregate(input.rows, currentFrom, input.today)
  const previous = aggregate(input.rows, previousFrom, previousTo)
  const currentRanks = rankTokens(current.tokens)
  const previousRanks = rankTokens(previous.tokens)
  const comparable = previous.total > 0n

  const entries: TrendMetricsEntry[] = []
  const ranked = [...current.tokens.entries()]
    .filter(([permaslug, value]) => permaslug !== 'other' && value > 0n)
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1))
  for (const [permaslug, value] of ranked) {
    const rank = currentRanks.get(permaslug) ?? 0
    const prevRank = previousRanks.get(permaslug)
    const share = ratio(value, current.total)
    const shareDelta = comparable && prevRank !== undefined
      ? round6(share - ratio(previous.tokens.get(permaslug) ?? 0n, previous.total))
      : null
    const rankDelta = comparable && prevRank !== undefined ? prevRank - rank : null
    const inTop = rank <= TREND_OR_TOP_N
    const moved = comparable && prevRank !== undefined && shareDelta !== null && Math.abs(shareDelta) >= TREND_OR_SHARE_DELTA && rank <= TREND_OR_MOVE_RANK_MAX
    if (!inTop && !moved) continue
    const kind = !comparable ? 'steady' : prevRank === undefined ? 'new-top' : moved ? 'moved' : 'steady'
    entries.push({
      id: permaslug,
      name: permaslug,
      creator: permaslug.includes('/') ? permaslug.slice(0, permaslug.indexOf('/')) : null,
      rank,
      rankDelta,
      kind,
      ...(shareDelta === null ? { share7d: share } : { share7d: share, shareDelta }),
    })
  }

  const meta: TrendMetricsMeta = {
    ...(input.meta.version === undefined ? {} : { version: input.meta.version }),
    ...(input.meta.startDate === undefined ? {} : { startDate: input.meta.startDate }),
    ...(input.meta.endDate === undefined ? {} : { endDate: input.meta.endDate }),
  }
  return {
    id: 'or-usage',
    status: 'ok',
    asOf: input.asOf,
    asOfKind: input.asOfKind,
    ...(Object.keys(meta).length === 0 ? {} : { meta }),
    ...(comparable ? {} : { note: 'baseline' as const }),
    entries,
    attribution: orAttribution(input.asOf),
    license: { name: TREND_OR_LICENSE_NAME, url: TREND_OR_LICENSE_URL },
    processed: true,
  }
}
