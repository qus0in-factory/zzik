import { useCallback, useState } from 'react'
import type { KeyValueStorage } from '@domain/usage/history/ports'

export const AA_TREND_EXPANDED_KEY = 'zzik:aa-trend-expanded:v1'

function load(storage: KeyValueStorage | undefined): boolean {
  try {
    return storage?.get(AA_TREND_EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

function save(storage: KeyValueStorage | undefined, expanded: boolean): void {
  try {
    storage?.set(AA_TREND_EXPANDED_KEY, expanded ? '1' : '0')
  } catch {
    /* 저장 실패는 무시(편의 기능) */
  }
}

/** 트렌드 패널의 펼침 상태. 저장소에 마지막 상태를 기억하고, 없거나 읽기 실패 시 접힘(기본값). */
export function useAaTrendExpanded(storage: KeyValueStorage | undefined): [boolean, () => void] {
  const [expanded, setExpanded] = useState(() => load(storage))
  const toggle = useCallback(() => {
    const next = !expanded
    setExpanded(next)
    save(storage, next)
  }, [expanded, storage])
  return [expanded, toggle]
}
