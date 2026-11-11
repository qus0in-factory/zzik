import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, errors } from 'jose'
import { JoseAccessVerifier } from '../../../../worker/infra/access/jose-access-verifier'
let keys: Awaited<ReturnType<typeof generateKeyPair>>
let resolver: ReturnType<typeof createLocalJWKSet>
const config = { issuer: 'https://team.cloudflareaccess.com', audience: 'aud' }
beforeAll(async () => {
  keys = await generateKeyPair('RS256')
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256' }] })
})
async function token(overrides: { aud?: string; iss?: string; exp?: number; alg?: string } = {}, privateKey?: CryptoKey) {
  return new SignJWT({ email: 'owner@example.com' }).setProtectedHeader({ alg: overrides.alg ?? 'RS256', kid: 'test' })
    .setIssuer(overrides.iss ?? config.issuer).setAudience(overrides.aud ?? config.audience)
    .setExpirationTime(overrides.exp ?? Math.floor(Date.now()/1000) + 300).sign(privateKey ?? keys.privateKey)
}
describe('Given a jose verifier with local RSA keys', () => {
  it('When a valid JWT is verified Then claims are returned', async () => {
    const result = await new JoseAccessVerifier(config, resolver).verify(await token())
    expect(result.ok && result.claims.email).toBe('owner@example.com')
  })
  it.each([{ aud: 'wrong' }, { iss: 'https://wrong.example' }, { exp: 1 }])('When claims are %j Then verification fails', async (claims) => {
    expect(await new JoseAccessVerifier(config, resolver).verify(await token(claims))).toEqual({ ok: false, reason: 'invalid' })
  })
  it('When the signature is different Then verification fails', async () => {
    const other = await generateKeyPair('RS256')
    expect(await new JoseAccessVerifier(config, resolver).verify(await token({}, other.privateKey))).toEqual({ ok: false, reason: 'invalid' })
  })
  it('When the algorithm is not RS256 Then verification fails', async () => {
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32))
    expect(await new JoseAccessVerifier(config, resolver).verify(jwt)).toEqual({ ok: false, reason: 'invalid' })
  })
  it('When the kid does not match Then verification is invalid', async () => {
    const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'unknown' }).sign(keys.privateKey)
    expect(await new JoseAccessVerifier(config, resolver).verify(jwt)).toEqual({ ok: false, reason: 'invalid' })
  })
  it.each([new TypeError('network'), new errors.JWKSTimeout(), new errors.JOSEError('HTTP 503')])('When key retrieval fails Then it is unavailable', async (error) => {
    expect(await new JoseAccessVerifier(config, async () => { throw error }).verify(await token())).toEqual({ ok: false, reason: 'unavailable' })
  })
  it('When the token is malformed Then it is invalid', async () => {
    expect(await new JoseAccessVerifier(config, resolver).verify('malformed')).toEqual({ ok: false, reason: 'invalid' })
  })
})
