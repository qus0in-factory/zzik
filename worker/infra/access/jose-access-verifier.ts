// Static-assets Workers do not receive ctx.access from the assets router.
// Verify the assertion directly instead of relying on that unavailable context.
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import type { AccessTokenVerifier, Verification } from '../../domain/access/verifier'

// Module lifetime cache: one resolver per configured issuer, never per request.
const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
export function remoteAccessKeys(issuer: string): JWTVerifyGetKey {
  let keys = remoteKeySets.get(issuer)
  if (!keys) { keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); remoteKeySets.set(issuer, keys) }
  return keys
}
export class JoseAccessVerifier implements AccessTokenVerifier {
  constructor(private readonly config: { issuer: string; audience: string }, private readonly keys: JWTVerifyGetKey) {}
  async verify(token: string): Promise<Verification> {
    try {
      const { payload } = await jwtVerify(token, async (...args) => {
        try { return await this.keys(...args) }
        catch (error) {
          if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error
          throw new KeyRetrievalFailure()
        }
      }, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256'], clockTolerance: 60, requiredClaims: ['exp'] })
      return { ok: true, claims: { email: payload.email } }
    } catch (error) {
      return { ok: false, reason: error instanceof KeyRetrievalFailure ? 'unavailable' : 'invalid' }
    }
  }
}
class KeyRetrievalFailure extends Error {}
