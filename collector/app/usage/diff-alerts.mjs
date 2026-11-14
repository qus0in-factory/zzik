import { barLevelOf, getUsageStatus, summaryUnitOf } from '../../../shared/usage-policy.ts'
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertReport} AlertReport */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertLimit} AlertLimit */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertState} AlertState */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertLevel} AlertLevel */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertEvent} AlertEvent */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertCheckpoint} Checkpoint */
export const ALERT_FLAP_MS = 30 * 60_000
export const ALERT_CAUTION_MIN_PERCENT = 25
/** 96 successful missing observations ~= 24 hours at the 900s interval. */
export const ALERT_MISSING_MAX_CYCLES = 96
/** @type {Record<AlertLevel,number>} */
const RANK = { normal: 0, caution: 1, danger: 2, limit: 3 }

/** Alert-only caution floor; dashboard policy is unchanged. @param {AlertLimit} item @returns {AlertLevel} */
function levelOf(item) {
  if (getUsageStatus(item.usedPercent) === 'limit') return 'limit'
  const bar = barLevelOf(item.usedPercent, item.elapsedPercent)
  if (bar === 'danger') return 'danger'
  return bar === 'caution' && item.usedPercent >= ALERT_CAUTION_MIN_PERCENT ? 'caution' : 'normal'
}
/** @param {unknown} state @returns {state is AlertState} */
function validState(state) {
  if (state === null || typeof state !== 'object') return false
  const s = /** @type {AlertState} */(state)
  if (s.version !== 1 || s.windows === null || typeof s.windows !== 'object' || Array.isArray(s.windows)) return false
  return Object.values(s.windows).every(w => w &&
    Object.hasOwn(RANK, w.level) && Object.hasOwn(RANK, w.notifiedLevel) &&
    Number.isFinite(w.usedPercent) && w.usedPercent >= 0 &&
    (w.notifiedAt === null || Number.isFinite(w.notifiedAt)))
}
/** @param {AlertState} state @param {string} id @returns {Checkpoint|null} */
const checkpoint = (state, id) => Object.hasOwn(state.windows, id) ? state.windows[id] : null
/** Keep the pre-zero cycle boundary even when a provider advances its reset early.
 * @param {Checkpoint|null} old
 */
function resetReference(old) {
  const saved = old?.resetReference
  return saved && typeof saved.resetsAt === 'string' && Number.isFinite(Date.parse(saved.resetsAt)) &&
    Number.isFinite(saved.usedPercent) && saved.usedPercent > 0 ? saved : old
}
/** A confirmed zero can arrive before the provider updates its reset timestamp.
 * @param {Checkpoint|null} old @param {AlertLimit} item @param {number} now
 */
function cycleReset(old, item, now) {
  const reference = resetReference(old)
  return reference !== null && (!item.expired || item.usedPercent === 0) &&
    reference.resetsAt !== null && Date.parse(reference.resetsAt) <= now && item.usedPercent < reference.usedPercent
}
/** Only a recognized month/week cycle qualifies; never infer cycles from a label or id.
 * @param {AlertState} previous @param {AlertReport} report @param {AlertLimit} item
 */
function primaryReset(previous, report, item) {
  const primary = report.limits.find(w => w.id === report.primaryId)
  const unit = summaryUnitOf(item)
  return previous.primaryId === item.id && primary !== undefined && unit !== null && summaryUnitOf(primary) === unit
}
/** Pure transition policy. All event transitions differ; reset phases also work when N was normal.
 * @param {AlertState|null} prevState @param {AlertReport} nextReport @returns {AlertEvent[]}
 */
export function diffAlerts(prevState, nextReport) {
  if (!validState(prevState)) return []
  const events = /** @type {AlertEvent[]} */([])
  const { nowMs, provider } = nextReport
  for (const item of nextReport.limits) {
    if (provider === 'claude' && item.id === 'extra_usage') continue
    const old = checkpoint(prevState, item.id)
    const from = old?.notifiedLevel ?? 'normal'
    if (cycleReset(old, item, nowMs)) {
      if (primaryReset(prevState, nextReport, item)) {
        events.push({provider, ...item, kind:'reset', from:'previous_cycle', to:'new_cycle', previousLevel:from, nowMs})
      } else if (from !== 'normal') {
        events.push({provider, ...item, kind:'level', from, to:'normal', nowMs})
      }
      continue
    }
    if (item.expired && item.usedPercent > 0) continue
    const to = levelOf(item)
    if (to === from) continue
    const cooled = old?.notifiedAt == null ? from === 'normal' : nowMs - old.notifiedAt >= ALERT_FLAP_MS
    const worsening = RANK[to] > RANK[from]
    const urgent = worsening && (from !== 'normal' || RANK[to] >= RANK.danger)
    if (cooled || urgent) events.push({provider, ...item, kind:'level', from, to, nowMs})
  }
  if (provider === 'claude' && typeof prevState.spendLimitReached === 'boolean' &&
      typeof nextReport.spendLimitReached === 'boolean' && prevState.spendLimitReached !== nextReport.spendLimitReached) {
    events.push({provider, id:'extra_usage', label:'추가 지출', kind:'spend',
      from:prevState.spendLimitReached ? 'limit' : 'normal', to:nextReport.spendLimitReached ? 'limit' : 'normal',
      usedPercent:null, elapsedPercent:null, resetsAt:null, nowMs})
  }
  return events
}
/** Persist last-notified N separately from observed values. Reset clears N and its cooldown.
 * @param {AlertState|null} prevState @param {AlertReport} report @param {AlertEvent[]} events @returns {AlertState}
 */
export function nextAlertState(prevState, report, events) {
  const valid = validState(prevState)
  const previous = valid ? prevState : null
  const entries = new Map(Object.entries(previous?.windows ?? {}))
  const seen = new Set(report.limits.map(w => w.id))
  for (const [id, saved] of entries) {
    const missing = seen.has(id) ? 0 : (Number.isSafeInteger(saved.missingCycles) && (saved.missingCycles ?? 0) >= 0 ? saved.missingCycles ?? 0 : 0) + 1
    if (missing >= ALERT_MISSING_MAX_CYCLES) entries.delete(id)
    else entries.set(id, {...saved, missingCycles:missing})
  }
  if (report.provider === 'claude') entries.delete('extra_usage')
  for (const item of report.limits) {
    if (report.provider === 'claude' && item.id === 'extra_usage') continue
    const old = previous === null ? null : checkpoint(previous, item.id)
    const reset = cycleReset(old, item, report.nowMs)
    if (!reset && item.expired && item.usedPercent > 0) continue
    const sent = events.find(e => e.id === item.id && e.kind === 'level')
    const level = levelOf(item)
    const notifiedLevel = reset ? 'normal' : sent ? /** @type {AlertLevel} */(sent.to) : old?.notifiedLevel ?? (valid ? 'normal' : level)
    const reference = resetReference(old)
    let pending = reset ? undefined : old?.resetReference
    if (!reset && reference?.resetsAt != null && Date.parse(reference.resetsAt) > report.nowMs &&
        item.usedPercent === 0 && reference.usedPercent > 0) {
      pending = {usedPercent:reference.usedPercent, resetsAt:reference.resetsAt}
    } else if (pending && item.usedPercent > pending.usedPercent) {
      pending = {...pending, usedPercent:item.usedPercent}
    }
    const baselineAt = (old?.notifiedLevel ?? (!valid ? level : 'normal')) !== 'normal' ? report.nowMs : null
    entries.set(item.id, {level, usedPercent:item.usedPercent, resetsAt:item.resetsAt, cycleSeconds:item.cycleSeconds,
      notifiedLevel, notifiedAt:reset ? null : sent ? report.nowMs : old?.notifiedAt ?? baselineAt,
      missingCycles:0, ...(pending ? {resetReference:pending} : {})})
  }
  const primary = report.primaryId ?? previous?.primaryId ?? null
  return {
    version:1,
    spendLimitReached:typeof report.spendLimitReached === 'boolean' ? report.spendLimitReached : previous?.spendLimitReached ?? null,
    primaryId:primary !== null && entries.has(primary) ? primary : null,
    windows:Object.fromEntries(entries),
  }
}
