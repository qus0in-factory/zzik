export type UsageReadStore = 'postgres' | 'd1'

export interface UsageReadStoreEnv {
  USAGE_READ_STORE?: string
}

export type UsageReadStoreResult =
  | { ok: true; store: UsageReadStore }
  | { ok: false; reason: 'storage_unavailable' }

/**
 * A-stage default is explicitly Postgres. D1 is only selected by an exact flag;
 * a typo or empty value never silently falls through to D1.
 */
export function resolveUsageReadStore(env: UsageReadStoreEnv): UsageReadStoreResult {
  const value = env.USAGE_READ_STORE
  if (value === undefined || value === '') return { ok: true, store: 'postgres' }
  if (value === 'postgres' || value === 'd1') return { ok: true, store: value }
  return { ok: false, reason: 'storage_unavailable' }
}
