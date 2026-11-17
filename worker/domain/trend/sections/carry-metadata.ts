import type { TrendItem } from '../../../../shared/trend-contract'

/** models.dev가 304/실패로 비었을 때 직전 공개 항목의 제작사·출시일·오픈웨이트 보강을 이월한다. */
export function carryEnrichment(item: TrendItem, prev: TrendItem | undefined): TrendItem {
  if (prev === undefined) return item
  return {
    ...item,
    name: item.name !== '' ? item.name : prev.name,
    creator: item.creator !== '' ? item.creator : prev.creator,
    releaseDate: item.releaseDate ?? prev.releaseDate,
    precision: item.releaseDate !== null ? item.precision : prev.precision,
    price: item.price ?? prev.price,
    providers: prev.providers.length > 0 ? prev.providers : item.providers,
    openWeights: item.openWeights || prev.openWeights,
  }
}
