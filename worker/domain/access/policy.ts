import type { AccessClaims } from './verifier'
export function isAllowed(claims: AccessClaims, allowedEmail: string): boolean {
  return typeof claims.email === 'string' && claims.email === allowedEmail
}
