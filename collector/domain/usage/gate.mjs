/**
 * 호출 게이트(ADR 0.2 D5). 로컬 상태의 nextAllowedAt 하나가 기준이다.
 * auth_required(401·403)는 1시간 뒤 해제되되, 자격 증명의 expiresAt이 바뀌면 즉시 해제한다.
 */

/** @typedef {import('./ports.mjs').GateState} GateState */

export const AUTH_REQUIRED_GATE_SEC = 3_600

/** 빈 게이트: 아무 제약도 없다. @returns {GateState} */
export function emptyGate() {
  return { nextAllowedAt: null, failReason: null, failCount: 0, authFailCount: 0, authDeniedExpiresAt: null }
}

/**
 * 지금 호출할 수 있는지. releasedByRefresh는 expiresAt 갱신으로 즉시 해제됐을 때만 참이다.
 * @param {GateState} gate
 * @param {number} nowMs
 * @param {number|null|undefined} credentialExpiresAt
 * @returns {{ allowed: boolean, releasedByRefresh?: boolean }}
 */
export function gateAllowsCall(gate, nowMs, credentialExpiresAt) {
  if (gate.nextAllowedAt === null || gate.nextAllowedAt === undefined) return { allowed: true }
  if (nowMs >= gate.nextAllowedAt) return { allowed: true }
  if (
    gate.failReason === 'auth_required' &&
    gate.authDeniedExpiresAt !== null &&
    credentialExpiresAt !== null &&
    credentialExpiresAt !== undefined &&
    credentialExpiresAt !== gate.authDeniedExpiresAt
  ) {
    return { allowed: true, releasedByRefresh: true }
  }
  return { allowed: false }
}

/**
 * 실패로 게이트를 연다. kind가 auth_required면 실패 계수는 별도 라인이라 0으로 되돌린다.
 * @param {GateState} gate
 * @param {{ now: number, kind: 'rate_limited'|'upstream_error'|'auth_required'|'auth_rejected', delaySec: number, credentialExpiresAt: number|null|undefined }} input
 * @returns {GateState}
 */
export function openGateFor(gate, { now, kind, delaySec, credentialExpiresAt }) {
  if (kind === 'auth_required' || kind === 'auth_rejected') {
    // 인증 거부는 전용 실패 카운터로 수열을 계산한다(429·5xx와 분리, v2 D4).
    return {
      nextAllowedAt: now + delaySec * 1000,
      failReason: 'auth_required',
      failCount: gate.failCount ?? 0,
      authFailCount: (gate.authFailCount ?? 0) + 1,
      authDeniedExpiresAt: credentialExpiresAt ?? null,
    }
  }
  return {
    nextAllowedAt: now + delaySec * 1000,
    failReason: kind,
    failCount: (gate.failCount ?? 0) + 1,
    authFailCount: gate.authFailCount ?? 0,
    authDeniedExpiresAt: gate.authDeniedExpiresAt ?? null,
  }
}

/** 봉투의 retryAt(같은 시각, 밀리초). 게이트가 없으면 null. @param {GateState} gate @returns {number|null} */
export function gateRetryAt(gate) {
  return gate.nextAllowedAt ?? null
}

/** 성공 → 게이트 완전 해제(D5: n은 0이 된다). @returns {GateState} */
export function resetGate() {
  return emptyGate()
}
