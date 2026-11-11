import { describe, it, expect } from 'vitest'
import { readConfig } from '../../../worker/infra/config'
const vars = { ACCESS_TEAM_DOMAIN: 'qus0in.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAIL: 'owner@example.com' }
describe('Given Worker vars', () => {
  it('When vars are valid Then the issuer uses https', () => {
    expect(readConfig(vars)).toEqual({ ok: true, config: { teamDomain: vars.ACCESS_TEAM_DOMAIN, issuer: 'https://qus0in.cloudflareaccess.com', audience: 'aud', allowedEmail: vars.ALLOWED_EMAIL } })
  })
  it.each(['', 'https://team.cloudflareaccess.com', 'team.cloudflareaccess.com/path', 'team.cloudflareaccess.com:443', ' team.cloudflareaccess.com', 'evil.example.com'])('When the domain is %s Then configuration fails closed', (domain) => {
    expect(readConfig({ ...vars, ACCESS_TEAM_DOMAIN: domain })).toEqual({ ok: false, reason: 'misconfigured' })
  })
  it.each(['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ALLOWED_EMAIL'] as const)('When %s is missing Then configuration fails', (key) => {
    expect(readConfig({ ...vars, [key]: undefined })).toEqual({ ok: false, reason: 'misconfigured' })
  })
})
