import type { UsageProvider } from '@domain/usage/providers'

/**
 * 저장된 순서(어떤 값이든)를 현재 제공자 목록에 맞춰 정규화한다.
 * 저장 순서를 유지하되 사라진 id·중복·문자열이 아닌 값은 버리고, 저장에 없는 새 제공자는 기본 순서대로 뒤에 붙인다.
 */
export function normalizeOrder(saved: unknown, defaults: readonly UsageProvider[]): UsageProvider[] {
  const known = new Set<string>(defaults)
  const kept: UsageProvider[] = []
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (typeof item === 'string' && known.has(item) && !kept.includes(item as UsageProvider)) kept.push(item as UsageProvider)
    }
  }
  return [...kept, ...defaults.filter((id) => !kept.includes(id))]
}

/** id를 toIndex 위치로 옮긴다(결과 배열에서 그 인덱스에 놓인다). 범위는 보정하고, 바뀌는 게 없으면 같은 배열을 돌려준다. */
export function moveProvider(order: readonly UsageProvider[], id: UsageProvider, toIndex: number): readonly UsageProvider[] {
  const from = order.indexOf(id)
  if (from === -1) return order
  const to = Math.max(0, Math.min(order.length - 1, toIndex))
  if (to === from) return order
  const next = order.filter((item) => item !== id)
  next.splice(to, 0, id)
  return next
}

export function isDefaultOrder(order: readonly UsageProvider[], defaults: readonly UsageProvider[]): boolean {
  return order.length === defaults.length && order.every((id, index) => id === defaults[index])
}

/** 순서 저장소 포트(구현은 infra: 브라우저 localStorage). 저장 형식·스키마 버전은 어댑터가 책임진다. */
export interface ProviderOrderPort {
  /** 저장된 순서(검증 전). 없거나 읽을 수 없으면 null */
  load(): unknown[] | null
  save(order: readonly UsageProvider[]): void
  clear(): void
}
