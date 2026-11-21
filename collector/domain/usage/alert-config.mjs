/** Dedicated usage-alert opt-in; task-report webhooks are never reused.
 * @param {Record<string,string|undefined>} env
 */
export function readAlertConfig(env) {
  // Discord user snowflake only; anything else (role/everyone/markup) is ignored.
  const mention = env.ZZIK_ALERT_MENTION_USER_ID?.trim()
  return {webhookUrl:env.ZZIK_ALERT_WEBHOOK_URL?.trim() || undefined, enabled:env.ZZIK_ALERTS !== '0', mentionUserId:mention && /^\d{17,20}$/.test(mention) ? mention : undefined}
}
