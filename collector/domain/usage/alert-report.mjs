import { scanUsageSeries } from '../../../shared/usage-scan/index.ts'
import { readAntigravity, AGY_QUOTA_RAW_SOURCE } from '../../../shared/usage-scan/antigravity.ts'
import { readCodexWindows } from '../../../shared/usage-scan/codex.ts'
import { elapsedPercent, summaryWindowOf } from '../../../shared/usage-policy.ts'
/** @typedef {import('./alert-types.mjs').AlertReport} AlertReport */
/** @typedef {import('../../../shared/usage-scan/types.ts').ScannedSeries} Series */
/** @param {Series} value */
function periodLabel(value) {
  const seconds = value.cycleSeconds
  if (seconds === 18000) return '5시간 한도'
  if (seconds === 604800) return '주간 한도'
  if (seconds !== null && seconds >= 28 * 86400 && seconds <= 31 * 86400) return '월간 한도'
  if (seconds !== null) return `${Math.floor(seconds / (seconds >= 86400 ? 86400 : seconds >= 3600 ? 3600 : 60))}${seconds >= 86400 ? '일' : seconds >= 3600 ? '시간' : '분'} 한도`
  return value.id
}
/** Display metadata stays outside the value scanner. @param {string} provider @param {Series} value @param {any} raw */
function labelOf(provider, value, raw) {
  if (provider === 'claude') {
    const labels = /** @type {Record<string,string>} */ ({ five_hour:'5시간 한도', seven_day:'주간 한도', seven_day_fable:'Fable 주간', seven_day_opus:'Opus 주간', seven_day_sonnet:'Sonnet 주간', seven_day_oauth_apps:'OAuth 앱 주간', seven_day_cowork:'Cowork 주간', extra_usage:'추가 사용량' })
    if (Object.hasOwn(labels, value.id)) return labels[value.id]
    const prefix = value.id.startsWith('seven_day_') ? 'seven_day_' : value.id.startsWith('five_hour_') ? 'five_hour_' : null
    return prefix ? `${prefix === 'seven_day_' ? '주간' : '5시간'} · ${value.id.slice(prefix.length).split('_').filter(Boolean).map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(' ')}` : value.id
  }
  if (provider === 'antigravity') {
    const bucket = readAntigravity(raw).buckets.find(b => b.id === value.id)
    const entry = bucket ? (raw.source === AGY_QUOTA_RAW_SOURCE ? raw.rows[bucket.bucketIndex] : raw.groups[bucket.groupIndex]) : null
    const group = entry && typeof entry === 'object' ? (raw.source === AGY_QUOTA_RAW_SOURCE ? entry.group : entry.displayName) : null
    const aliases = /** @type {Record<string,string>} */ ({'gemini models':'Gemini','claude and gpt models':'Claude·GPT','gemini 4 argon':'Argon'})
    const name = typeof group === 'string' ? aliases[group.trim().toLowerCase()] ?? group : 'Antigravity'
    return `${name} · ${bucket?.window === '5h' ? '5시간 한도' : bucket?.window === 'weekly' ? '주간 한도' : `${bucket?.window || '알 수 없는'} 한도`}`
  }
  if (provider === 'grok') return raw.config?.currentPeriod?.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? '주간 크레딧' : raw.config?.currentPeriod?.type === 'USAGE_PERIOD_TYPE_MONTHLY' ? '월간 크레딧' : '크레딧 사용률'
  if (provider === 'ollama') return '포함 크레딧'
  if (provider === 'opencode') return value.id === 'rolling' ? '단기 한도' : value.id === 'weekly' ? '주간 한도' : value.id === 'monthly' ? '월간 한도' : `${value.id} 한도`
  const base = periodLabel(value)
  return value.id === 'rate_limit' || value.id.startsWith('rate_limit.') ? base : `${value.id.split(/[.[]/)[0].split('_').map(s => s.charAt(0).toUpperCase()+s.slice(1)).join(' ')} · ${base}`
}
/** Never reads clocks, credentials or I/O. Expired zero is retained to detect actual resets.
 * @param {string} provider @param {string|null} rawText @param {number} nowMs @param {readonly string[]} rawRedacted
 * @returns {AlertReport|null}
 */
export function buildAlertReport(provider, rawText, nowMs, rawRedacted) {
  try {
    if (rawText === null) return null
    const raw = JSON.parse(rawText)
    const scan = scanUsageSeries(/** @type {import('../../../shared/usage-contract.ts').UsageProvider} */(provider), raw, { fetchedAt: null, rawRedacted })
    if (!scan.ok) return null
    // Reuse the Codex reader with this successful fetchedAt for relative reset fields.
    // The generic history scanner keeps expired values here (fetchedAt:null), since a
    // just-reset zero can still carry the former reset timestamp.
    const codexWindows = provider === 'codex' ? readCodexWindows(raw, {fetchedAt:new Date(nowMs).toISOString()}).windows : []
    const values = scan.series.map(value => { const codex = codexWindows.find(w => w.path === value.id); return codex ? {...value,resetsAt:codex.resetsAt} : value })
    const limits = values.map(value => ({ ...value, label: labelOf(provider, value, raw), elapsedPercent: elapsedPercent(value.resetsAt, value.cycleSeconds, new Date(nowMs)), expired: value.resetsAt !== null && Date.parse(value.resetsAt) < nowMs }))
    // Claude scoped metrics are not windows in the dashboard summary.
    const windows = provider === 'claude' ? limits.filter(w => w.id === 'five_hour' || w.id === 'seven_day') : provider === 'codex' ? limits.filter(w => w.id === 'rate_limit' || w.id.startsWith('rate_limit.')) : limits
    return { provider, nowMs, limits, primaryId: summaryWindowOf(windows, provider)?.id ?? null }
  } catch { return null }
}
