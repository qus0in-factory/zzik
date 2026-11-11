import { parseStoredSnapshot } from '../../domain/usage/stored-snapshot'
import type { SnapshotStore } from '../../domain/usage/store'
export async function getUsage(store: SnapshotStore) {
  const result = await store.read()
  return result.ok ? parseStoredSnapshot(result.value) : result
}
