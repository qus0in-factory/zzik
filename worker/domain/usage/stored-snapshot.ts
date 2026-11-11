export type StoredSnapshot = Record<string, unknown>
export type SnapshotResult = { ok: true; snapshot: StoredSnapshot | null } | { ok: false; reason: 'snapshot_corrupt' }
export function parseStoredSnapshot(raw: string | null): SnapshotResult {
  if (raw === null) return { ok: true, snapshot: null }
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, 'schema')) {
      return { ok: true, snapshot: value as StoredSnapshot }
    }
  } catch { /* Invalid stored JSON is a corrupt snapshot, not a storage outage. */ }
  return { ok: false, reason: 'snapshot_corrupt' }
}
