import type { UsageProvider } from '../../../shared/usage-contract'

/**
 * 저장된 봉투 해석(ADR 0.2 D8, 0.3 D7). 내용은 가공하지 않고,
 * 요청한 제공자와 봉투의 provider가 다르면 corrupt로 본다(D7: 다른 제공자의 값이 나가지 않게).
 */
export type StoredSnapshot = Record<string, unknown>
export type SnapshotResult = { ok: true; snapshot: StoredSnapshot | null } | { ok: false; reason: 'snapshot_corrupt' }

export function parseStoredSnapshot(raw: string | null, provider: UsageProvider): SnapshotResult {
  if (raw === null) return { ok: true, snapshot: null }
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, 'schema') &&
      (value as { provider?: unknown }).provider === provider
    ) {
      return { ok: true, snapshot: value as StoredSnapshot }
    }
  } catch { /* Invalid stored JSON is a corrupt snapshot, not a storage outage. */ }
  return { ok: false, reason: 'snapshot_corrupt' }
}
