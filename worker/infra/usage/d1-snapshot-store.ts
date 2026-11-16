import type { UsageProvider } from '../../../shared/usage-contract'
import type { SnapshotStore, StoreResult } from '../../domain/usage/store'
import type { D1DatabaseLike } from './d1-history-store'

interface EnvelopeRow {
  envelope: string
}

/** Read-only D1 snapshot adapter. A-stage keeps this behind a disabled read flag. */
export class D1SnapshotStore implements SnapshotStore {
  constructor(private readonly db: D1DatabaseLike | null) {}

  async read(provider: UsageProvider): Promise<StoreResult> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const result = await this.db.prepare('SELECT envelope FROM usage_snapshot WHERE provider = ? LIMIT 1').bind(provider).all<EnvelopeRow>()
      if (result.success === false) throw new Error('D1 statement failed')
      return { ok: true, value: result.results[0]?.envelope ?? null }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }
}
