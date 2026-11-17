import { useMemo, useState } from 'react'
import { NEW_MODELS_PAGE_SIZE, sortNewModelsByLatest } from '@domain/trend/new-models'
import type { TrendItem } from '@shared/trend-contract'

export interface NewModelsPagination {
  visibleItems: TrendItem[]
  remaining: number
  lastAdded: number | null
  showMore(): { added: number; visible: number }
}

export function useNewModelsPagination(items: readonly TrendItem[] | undefined): NewModelsPagination {
  const sorted = useMemo(() => (items === undefined ? [] : sortNewModelsByLatest(items)), [items])
  const [visibleCount, setVisibleCount] = useState(NEW_MODELS_PAGE_SIZE)
  const [lastAdded, setLastAdded] = useState<number | null>(null)
  const visibleItems = sorted.slice(0, visibleCount)
  const remaining = Math.max(0, sorted.length - visibleItems.length)

  function showMore(): { added: number; visible: number } {
    const nextVisible = Math.min(sorted.length, visibleItems.length + NEW_MODELS_PAGE_SIZE)
    const added = nextVisible - visibleItems.length
    setVisibleCount(nextVisible)
    setLastAdded(added)
    return { added, visible: nextVisible }
  }

  return { visibleItems, remaining, lastAdded, showMore }
}
