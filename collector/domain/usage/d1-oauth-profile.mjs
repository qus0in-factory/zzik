export const DEFAULT_COLLECTOR_OAUTH_PROFILE='zzik-collector'
/** Named profile only: never silently share Wrangler's human default/staging cache.
 * @param {unknown} profile @returns {profile is string} */
export function isCollectorOAuthProfile(profile){return typeof profile==='string'&&/^[a-zA-Z0-9_-]+$/.test(profile)&&!['default','staging'].includes(profile.toLowerCase())}
