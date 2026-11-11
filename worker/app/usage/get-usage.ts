import { parseStoredSnapshot } from '../../domain/usage/stored-snapshot'
import type { SnapshotStore } from '../../domain/usage/store'
import type { UsageProvider } from '../../../shared/usage-contract'

/** 저장소에서 제공자별 봉투를 읽어 해석한다(ADR 0.3 D7). */
export async function getUsage(store: SnapshotStore, provider: UsageProvider) {
  const result = await store.read(provider)
  return result.ok ? parseStoredSnapshot(result.value, provider) : result
}
