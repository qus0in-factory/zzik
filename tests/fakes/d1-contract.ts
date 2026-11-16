import type { UsageEnvelope } from '../../shared/usage-contract'

/** Synthetic values, using the envelope and raw-object shape checked read-only before A. */
export const D1_OPERATION_ID = '11111111-1111-4111-8111-111111111111'
export const D1_NOW = '2026-11-16T03:00:00.123Z'
export function d1Envelope(overrides: Partial<UsageEnvelope> = {}): UsageEnvelope {
  return {
    schema: 1, provider: 'claude', status: 'ok', called: true, runAt: D1_NOW,
    fetchedAt: D1_NOW, httpStatus: 200, retryAt: null, tokenExpiresAt: null,
    kvTokenExpiresAt: null, intervalSec: 900, collectorVersion: '0.6.20',
    rawText: '{"five_hour":{"utilization":37}}', rawOmitted: null, ...overrides,
  }
}
export function successValue<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(result.reason)
  return result.value
}
