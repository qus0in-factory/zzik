import type { TrendItem } from '@shared/trend-contract'

export const NEW_MODELS_PAGE_SIZE = 6

function releaseTimestamp(releaseDate: string | null): number {
  if (releaseDate === null) return -1
  const ms = Date.parse(releaseDate)
  return Number.isFinite(ms) ? ms : -1
}

/**
 * 클라이언트 표시용 신규 모델 정렬.
 * API 응답은 OpenRouter 등록순(최신 등록 우선)으로 내려오므로,
 * 출시일(releaseDate) 최신순을 우선하고 동률·미상일 때는 서버 등록순을 유지한다.
 */
export function sortNewModelsByLatest(items: readonly TrendItem[]): TrendItem[] {
  return items
    .map((item, index) => ({ item, index, releaseMs: releaseTimestamp(item.releaseDate) }))
    .sort((a, b) => b.releaseMs - a.releaseMs || a.index - b.index)
    .map(({ item }) => item)
}
