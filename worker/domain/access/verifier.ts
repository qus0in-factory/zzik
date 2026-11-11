export interface AccessClaims { email?: unknown }
export type Verification = { ok: true; claims: AccessClaims } | { ok: false; reason: 'invalid' | 'unavailable' }
export interface AccessTokenVerifier { verify(token: string): Promise<Verification> }
export interface AccessConfig { teamDomain: string; issuer: string; audience: string; allowedEmail: string }
export type ConfigResult = { ok: true; config: AccessConfig } | { ok: false; reason: 'misconfigured' }
