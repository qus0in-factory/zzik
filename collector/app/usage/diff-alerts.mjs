import { barLevelOf, getUsageStatus, summaryUnitOf } from '../../../shared/usage-policy.ts'
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertReport} AlertReport */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertLimit} AlertLimit */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertState} AlertState */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertLevel} AlertLevel */
/** @typedef {import('../../domain/usage/alert-types.mjs').AlertEvent} AlertEvent */
export const ALERT_FLAP_MS = 30 * 60_000
/** @type {Record<AlertLevel,number>} */
const RANK = { normal:0, caution:1, danger:2, limit:3 }
/** @param {AlertLimit} item @returns {AlertLevel} */
function levelOf(item) {
  if (getUsageStatus(item.usedPercent) === 'limit') return 'limit'
  const bar = barLevelOf(item.usedPercent, item.elapsedPercent)
  return bar === 'danger' || bar === 'caution' ? bar : 'normal'
}
/** Treat old/corrupt alert checkpoints as a new baseline. @param {unknown} state @returns {state is AlertState} */
function validState(state) {
  if (state === null || typeof state !== 'object') return false
  const s = /** @type {AlertState} */(state)
  return s.version === 1 && s.windows !== null && typeof s.windows === 'object' && !Array.isArray(s.windows) && Object.values(s.windows).every(w => w && Object.hasOwn(RANK,w.level) && Object.hasOwn(RANK,w.notifiedLevel) && Number.isFinite(w.usedPercent) && (w.notifiedAt === null || Number.isFinite(w.notifiedAt)))
}
/** Pure transition policy, with time supplied in the report. @param {AlertState|null} prevState @param {AlertReport} nextReport @returns {AlertEvent[]} */
export function diffAlerts(prevState, nextReport) {
  if (!validState(prevState)) return []
  const events = /** @type {AlertEvent[]} */([])
  const { nowMs, provider } = nextReport
  for (const item of nextReport.limits) {
    if (provider === 'claude' && item.id === 'extra_usage') continue
    if (item.expired && item.usedPercent > 0) continue
    const old = Object.hasOwn(prevState.windows,item.id) ? prevState.windows[item.id] : null
    const from = old?.notifiedLevel ?? 'normal', to = levelOf(item)
    const worsening = RANK[to] > RANK[old?.level ?? 'normal'] || RANK[to] > RANK[from]
    const recovery = to === 'normal' && from !== 'normal'
    const cooled = old?.notifiedAt == null || nowMs - old.notifiedAt >= ALERT_FLAP_MS
    const escalating = from !== 'normal' && RANK[to] > RANK[from]
    if ((worsening || recovery) && (cooled || escalating)) events.push({ provider, ...item, kind:'level', from, to, nowMs })
  }
  // Keep the former primary if equal-period use ordering changes at reset.
  const currentPrimary = nextReport.limits.find(w => w.id === nextReport.primaryId)
  const oldPrimary = prevState.primaryId === null ? null : prevState.windows[prevState.primaryId]
  const currentOld = nextReport.limits.find(w => w.id === prevState.primaryId)
  if (currentPrimary && oldPrimary && currentOld && currentOld.id !== 'extra_usage' && summaryUnitOf(currentPrimary) === summaryUnitOf(currentOld) && currentOld.usedPercent === 0 && oldPrimary.usedPercent > 0 && oldPrimary.resetsAt !== null && Date.parse(oldPrimary.resetsAt) <= nowMs) {
    const clearing = events.findIndex(e => e.id === currentOld.id && e.kind === 'level')
    if (clearing >= 0) events.splice(clearing, 1)
    events.push({ provider, ...currentOld, kind:'reset', from:oldPrimary.level, to:'normal', nowMs })
  }
  if (provider === 'claude' && typeof prevState.spendLimitReached === 'boolean' && typeof nextReport.spendLimitReached === 'boolean' && prevState.spendLimitReached !== nextReport.spendLimitReached) {
    events.push({provider,id:'extra_usage',label:'추가 지출',kind:'spend',from:prevState.spendLimitReached ? 'limit' : 'normal',to:nextReport.spendLimitReached ? 'limit' : 'normal',usedPercent:null,elapsedPercent:null,resetsAt:null,nowMs})
  }
  return events
}
/** Persist observed values and last emitted levels; suppressed changes remain pending.
 * @param {AlertState|null} prevState @param {AlertReport} report @param {AlertEvent[]} events @returns {AlertState}
 */
export function nextAlertState(prevState, report, events) {
  const previous = validState(prevState) ? prevState.windows : {}
  const entries = new Map(Object.entries(previous))
  if (report.provider === 'claude') entries.delete('extra_usage')
  for (const item of report.limits) {
    if (report.provider === 'claude' && item.id === 'extra_usage') continue
    if (item.expired && item.usedPercent > 0) continue
    const old = Object.hasOwn(previous,item.id) ? previous[item.id] : null
    const sent = events.find(e => e.id === item.id)
    const level = levelOf(item)
    entries.set(item.id, { level, usedPercent:item.usedPercent, resetsAt:item.resetsAt, cycleSeconds:item.cycleSeconds, notifiedLevel:sent?.to ?? old?.notifiedLevel ?? (validState(prevState) ? 'normal' : level), notifiedAt:sent ? report.nowMs : old?.notifiedAt ?? null })
  }
  return { version:1, spendLimitReached: typeof report.spendLimitReached === 'boolean' ? report.spendLimitReached : validState(prevState) ? prevState.spendLimitReached ?? null : null, primaryId:report.primaryId ?? (validState(prevState) ? prevState.primaryId : null), windows:Object.fromEntries(entries) }
}
