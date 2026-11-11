export type StoreResult = { ok: true; value: string | null } | { ok: false; reason: 'storage_unavailable' }
export interface SnapshotStore { read(): Promise<StoreResult> }
