import type { SnapshotStore, StoreResult } from '../../domain/usage/store'
export class KvSnapshotStore implements SnapshotStore {
  constructor(private readonly kv: { get(key: string): Promise<string | null> }) {}
  async read(): Promise<StoreResult> {
    try { return { ok: true, value: await this.kv.get('usage:claude') } }
    catch { return { ok: false, reason: 'storage_unavailable' } }
  }
}
