import { isAllowed } from '../../domain/access/policy'
import type { AccessTokenVerifier } from '../../domain/access/verifier'
export type Authorization = { ok: true } | { ok: false; reason: 'missing' | 'invalid' | 'forbidden' | 'unavailable' }
export async function authorize(token: string | null, verifier: AccessTokenVerifier, allowedEmail: string): Promise<Authorization> {
  if (!token?.trim()) return { ok: false, reason: 'missing' }
  const result = await verifier.verify(token)
  if (!result.ok) return result
  return isAllowed(result.claims, allowedEmail) ? { ok: true } : { ok: false, reason: 'forbidden' }
}
