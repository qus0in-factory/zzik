/** Pure rollback projection. The caller must first commit PG and separately persist files/marker. */
import { isRecord, isUsageProvider, isUsageStatus, normalizeD1Instant, parseD1Envelope, canonicalEnvelope } from '../../../shared/d1-canonical.ts'
/** @typedef {import('./ports.mjs').CollectorState} CollectorState */
/** @typedef {import('./ports.mjs').GateState} GateState */
/** @typedef {import('./alert-types.mjs').AlertState} AlertState */
/** @typedef {{providerState:CollectorState,pruneState:CollectorState,warnings:('prune_time_unknown')[]}} LegacyProjection */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */
/** @param {unknown} value @returns {boolean} */
const nullableEpoch = value => value === null || (typeof value === 'number' && Number.isSafeInteger(value))
/** @param {unknown} value @returns {boolean} */
const counter = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
/** @param {unknown} value @returns {boolean} */
function validGate(value) {
  return isRecord(value) && nullableEpoch(value.nextAllowedAt) && nullableEpoch(value.authDeniedExpiresAt)
    && (value.failReason === null || (typeof value.failReason === 'string' && ['auth_required','auth_rejected','rate_limited','upstream_error'].includes(value.failReason)))
    && counter(value.failCount) && counter(value.authFailCount)
}
/** @param {unknown} value @returns {boolean} */
function validAlerts(value) {
  if (value === null) return true
  if (!isRecord(value) || value.version !== 1 || !(value.primaryId === null || typeof value.primaryId === 'string') || !isRecord(value.windows)
    || (value.spendLimitReached !== undefined && value.spendLimitReached !== null && typeof value.spendLimitReached !== 'boolean')) return false
  const levels = ['normal','caution','danger','limit']
  return Object.values(value.windows).every(w => isRecord(w) && typeof w.level === 'string' && levels.includes(w.level) && typeof w.notifiedLevel === 'string' && levels.includes(w.notifiedLevel) && nullableEpoch(w.notifiedAt)
    && typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent)
    && (w.resetsAt === null || normalizeD1Instant(w.resetsAt).ok)
    && (w.cycleSeconds === null || (typeof w.cycleSeconds === 'number' && Number.isFinite(w.cycleSeconds) && w.cycleSeconds > 0))
    && (w.missingCycles === undefined || counter(w.missingCycles))
    && (w.resetReference === undefined || (isRecord(w.resetReference) && typeof w.resetReference.usedPercent === 'number' && Number.isFinite(w.resetReference.usedPercent) && normalizeD1Instant(w.resetReference.resetsAt).ok)))
}
/** @param {unknown} ledger @param {unknown} pgCommitted @returns {Result<LegacyProjection>} */
export function ledgerToLegacyState(ledger, pgCommitted) {
  if (!isRecord(ledger) || !isUsageProvider(ledger.provider) || !validGate(ledger.gate) || !validAlerts(ledger.alerts) || !isRecord(ledger.lastRun)
    || !(ledger.lastRun.status === null || isUsageStatus(ledger.lastRun.status)) || !nullableEpoch(ledger.lastRun.tokenExpiresAt)) return { ok: false, reason: 'invalid_ledger_state' }
  if (!isRecord(pgCommitted) || pgCommitted.provider !== ledger.provider) return { ok: false, reason: 'invalid_committed_state' }
  if (pgCommitted.previous !== null) {
    let text
    try { text = JSON.stringify(pgCommitted.previous) } catch { return { ok: false, reason: 'invalid_committed_state' } }
    const parsed = parseD1Envelope(text)
    if (!parsed.ok || parsed.value.provider !== ledger.provider) return { ok: false, reason: 'invalid_committed_state' }
  }
  const lastEvent = pgCommitted.lastEventAt === null ? null : normalizeD1Instant(pgCommitted.lastEventAt)
  if ((lastEvent !== null && !lastEvent.ok) || (pgCommitted.previous === null && lastEvent !== null)) return { ok: false, reason: 'invalid_committed_state' }
  if (lastEvent?.ok && isRecord(pgCommitted.previous)) {
    const previousAt = normalizeD1Instant(pgCommitted.previous.runAt)
    if (!previousAt.ok || lastEvent.value.ms > previousAt.value.ms) return { ok: false, reason: 'invalid_committed_state' }
  }
  const prune = normalizeD1Instant(ledger.lastPruneAt)
  /** @type {('prune_time_unknown')[]} */
  const warnings = prune.ok ? [] : ['prune_time_unknown']
  const lastPruneAt = prune.ok ? prune.value.iso : null
  const currentGate = /** @type {GateState} */ (ledger.gate)
  const gate = { nextAllowedAt: currentGate.nextAllowedAt, failReason: currentGate.failReason, failCount: currentGate.failCount,
    authFailCount: currentGate.authFailCount, authDeniedExpiresAt: currentGate.authDeniedExpiresAt }
  const currentAlerts = /** @type {AlertState|null} */ (ledger.alerts)
  const alerts = currentAlerts === null ? null : { version: 1, primaryId: currentAlerts.primaryId,
    ...(currentAlerts.spendLimitReached === undefined ? {} : {spendLimitReached:currentAlerts.spendLimitReached}),
    windows: Object.fromEntries(Object.entries(currentAlerts.windows).map(([id, w]) => [id, {
      level:w.level,notifiedLevel:w.notifiedLevel,notifiedAt:w.notifiedAt,usedPercent:w.usedPercent,resetsAt:w.resetsAt,cycleSeconds:w.cycleSeconds,
      ...(w.missingCycles === undefined ? {} : {missingCycles:w.missingCycles}),
      ...(w.resetReference === undefined ? {} : {resetReference:{usedPercent:w.resetReference.usedPercent,resetsAt:w.resetReference.resetsAt}}),
    }])) }
  const lastRun = {status:ledger.lastRun.status,tokenExpiresAt:ledger.lastRun.tokenExpiresAt}
  // Canonical JSON rejects non-JSON/unsafe values; parse yields detached copies, never aliases.
  let json
  try { json = JSON.stringify({ schema: 1, provider: ledger.provider, previous: pgCommitted.previous, lastEventAt: lastEvent?.ok ? lastEvent.value.iso : null,
    gate, alerts, lastRun, lastPruneAt }) } catch { return { ok: false, reason: 'invalid_ledger_state' } }
  const sorted = canonicalEnvelope(json)
  if (!sorted.ok) return { ok: false, reason: 'invalid_ledger_state' }
  /** @type {CollectorState} */
  const providerState = JSON.parse(sorted.value)
  return { ok: true, value: { providerState, warnings, pruneState: { schema: 1, provider: null, previous: null, lastEventAt: null, alerts: null,
    lastRun: {status:null,tokenExpiresAt:null}, gate: {nextAllowedAt:null,failReason:null,failCount:0,authFailCount:0,authDeniedExpiresAt:null}, lastPruneAt } } }
}
