import type { UsageProvider } from '../../../shared/usage-contract'
import { USAGE_KV_KEYS } from '../../../shared/usage-contract'
import type { SnapshotStore, StoreResult } from '../../domain/usage/store'

/** 제공자별 KV 키를 읽는 저장소 어댑터(ADR 0.3 D7). 키는 표에서 고르고 조립하지 않는다. */
export class KvSnapshotStore implements SnapshotStore {
  constructor(private readonly kv: { get(key: string): Promise<string | null> }) {}
  async read(provider: UsageProvider): Promise<StoreResult> {
    try {
      return { ok: true, value: await this.kv.get(USAGE_KV_KEYS[provider]) }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }
}
