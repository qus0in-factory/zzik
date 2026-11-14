/** Unchanged providers still need bounded history samples; no database read is needed. */
export const EVENT_HEARTBEAT_MS = 6 * 60 * 60 * 1000
/** Unknown legacy checkpoints seed one event; future/invalid clocks must not freeze history.
 * @param {unknown} lastEventAt @param {number} nowMs @returns {boolean}
 */
export function eventHeartbeatDue(lastEventAt, nowMs) {
  const previous = typeof lastEventAt === 'string' ? Date.parse(lastEventAt) : NaN
  return !Number.isFinite(previous) || previous > nowMs || nowMs - previous >= EVENT_HEARTBEAT_MS
}
