/** Dedicated usage-alert opt-in; task-report webhooks are never reused.
 * @param {Record<string,string|undefined>} env
 */
export function readAlertConfig(env) {
  return {webhookUrl:env.ZZIK_ALERT_WEBHOOK_URL?.trim() || undefined, enabled:env.ZZIK_ALERTS !== '0'}
}
