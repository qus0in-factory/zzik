import type { UsageProvider } from '../../../shared/usage-contract'

export type StoreResult = { ok: true; value: string | null } | { ok: false; reason: 'storage_unavailable' }
export interface SnapshotStore { read(provider: UsageProvider): Promise<StoreResult> }
