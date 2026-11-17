import { formatAlertMessage, formatAlertPreview } from '../../domain/usage/alert-message.mjs'
export const DISCORD_ALERT_TIMEOUT_MS = 5000
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertEvent} AlertEvent */
/**
 * No request/response/error body or webhook URL is logged. No retries within the collection cycle.
 * @param {{webhookUrl?:string,enabled?:boolean,fetchImpl?:typeof fetch,log?:(safeMessage:string)=>void}} [deps]
 */
export function createDiscordAlerts({ webhookUrl, enabled = true, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  /** @param {string} status @param {number} count @param {AlertEvent[]} [events] */
  const record = (status,count,events = []) => {
    try { log(`alerts=${status} count=${count} message=${status === 'dry_run' ? formatAlertPreview(events) : '[가림]'}`) } catch { /* logging must not affect collection */ }
    return {status,count}
  }
  /** @param {string} content @param {number} count */
  const sendMessage = async (content,count) => {
    if (count === 0) return {status:'empty',count:0}
    if (!enabled || !webhookUrl?.trim()) return record('disabled',count)
    try {
      const response = await fetchImpl(webhookUrl, {
        method:'POST',redirect:'manual',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content,allowed_mentions:{parse:[]}}),
        signal:AbortSignal.timeout(DISCORD_ALERT_TIMEOUT_MS),
      })
      return record(response.ok ? 'sent' : 'failed',count)
    } catch { return record('failed',count) }
  }
  return {
    timeoutMs:DISCORD_ALERT_TIMEOUT_MS,
    sendMessage,
    /** @param {AlertEvent[]} events @param {{dryRun?:boolean}} [options] */
    async send(events, options = {}) {
      if (options.dryRun) return record('dry_run',events.length,events)
      return sendMessage(formatAlertMessage(events),events.length)
    },
  }
}
