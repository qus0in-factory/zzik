export type CollectionStatus = 'ok' | 'rate_limited' | 'token_expired' | 'auth_required' | 'no_credentials' | 'upstream_error' | 'network_error'
export interface UsageSnapshot {
  schema: 1
  provider: 'claude'
  status: CollectionStatus
  called: boolean
  runAt: string
  fetchedAt: string | null
  httpStatus: number | null
  retryAt: string | null
  tokenExpiresAt: string | null
  kvTokenExpiresAt: string | null
  intervalSec: number
  collectorVersion: string
  rawText: string | null
  rawOmitted: 'too_large' | null
}
export type UsageCollectionMeta = Omit<UsageSnapshot, 'rawText'>
