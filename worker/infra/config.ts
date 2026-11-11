import type { ConfigResult } from '../domain/access/verifier'
export function readConfig(vars: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string; ALLOWED_EMAIL?: string }): ConfigResult {
  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience, ALLOWED_EMAIL: allowedEmail } = vars
  if (!teamDomain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(teamDomain) ||
      !audience?.trim() || audience !== audience.trim() || !allowedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(allowedEmail)) {
    return { ok: false, reason: 'misconfigured' }
  }
  return { ok: true, config: { teamDomain, issuer: `https://${teamDomain}`, audience, allowedEmail } }
}
