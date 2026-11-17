import type { AaTrendResponse } from '@shared/trend-contract'

export type AaTrendResult =
  | { ok: true; value: AaTrendResponse }
  | { ok: false; reason: 'not_ready' | 'unauthorized' | 'api_error' | 'network_error'; message: string | null }

export interface AaTrendGateway {
  fetchAaTrend(): Promise<AaTrendResult>
}
