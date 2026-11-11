/**
 * 수집기의 한 실행(ADR 0.2 D2). 포트를 주입받아 순서대로 진행한다.
 *
 *   게이트·자격 증명 확인 → usage 호출(게이트가 허용할 때만) → 봉투 생성
 *   → 상태 저장(게이트로 건너뛴 실행도 쓴다: 하트비트) → KV PUT → 로그 한 줄
 *
 * - 자격 증명이 없거나 만료된 것은 정상 상태 중 하나다(종료 코드 0).
 * - KV 쓰기가 실패하면 재시도 루프 없이 0이 아닌 코드로 끝낸다. 로컬 상태가 기준이다.
 * - --dry-run은 상태·KV·로그 어디에도 쓰지 않고 status·키 목록·본문 sha256만 되돌린다.
 * - 토큰은 usage 포트에만 흐르고 봉투·상태·KV·로그 어디에도 남지 않는다.
 */

import { retryDelaySec } from '../../domain/usage/backoff.mjs'
import { chooseCredential, credentialExpired } from '../../domain/usage/credential-choice.mjs'
import { buildEnvelope, sha256Hex } from '../../domain/usage/envelope.mjs'
import { gateAllowsCall, gateRetryAt, openGateFor, resetGate, AUTH_REQUIRED_GATE_SEC } from '../../domain/usage/gate.mjs'

export const USAGE_INTERVAL_SEC = 300
const EXIT_OK = 0
const EXIT_KV_FAILURE = 3

/** 로컬 상태 파일의 기본 형태(D2 usage-state.json). */
export function emptyCollectorState() {
  return {
    schema: 1,
    previous: null,
    gate: { nextAllowedAt: null, failReason: null, failCount: 0, authDeniedExpiresAt: null },
    lastRun: { status: null, tokenExpiresAt: null },
  }
}

/** 상태 파일이 부분적으로만 있거나 오래된 형태일 때 보완한다. */
function normalizeState(state) {
  const base = emptyCollectorState()
  if (state === null || typeof state !== 'object') return base
  return {
    schema: 1,
    previous: state.previous ?? null,
    gate: { ...base.gate, ...(typeof state.gate === 'object' && state.gate !== null ? state.gate : {}) },
    lastRun: {
      status: state.lastRun?.status ?? null,
      tokenExpiresAt: state.lastRun?.tokenExpiresAt ?? null,
    },
  }
}

export async function runOnce(ports, options = {}) {
  const dryRun = options.dryRun === true
  const collectorVersion = options.collectorVersion ?? '0.2.0'
  const nowMs = ports.clock.now()
  const state = normalizeState(await ports.state.read())

  // 자격 증명을 먼저 읽는다. 401 게이트의 즉시 해제 판정에 현재 expiresAt이 필요하기 때문이다(D5).
  const reads = await ports.credentials.readAll()
  const chosen = chooseCredential(reads, nowMs)

  const gateDecision = gateAllowsCall(state.gate, nowMs, chosen?.expiresAt ?? undefined)
  let gate = gateDecision.releasedByRefresh === true ? resetGate() : state.gate

  let status
  let called = false
  let httpStatus = null
  let bodyResult = null
  let retryAtMs = null

  if (gateDecision.allowed === false) {
    // 게이트로 건너뛴 실행: 하트비트 봉투만 쓴다(D2).
    status = state.previous?.status ?? 'no_credentials'
    retryAtMs = gateRetryAt(gate)
  } else if (chosen === null) {
    status = 'no_credentials'
  } else if (credentialExpired(chosen, nowMs)) {
    status = 'token_expired'
  } else {
    const result = await ports.usage.fetchUsage(chosen.token)
    called = true
    if (result.ok === true) {
      status = 'ok'
      httpStatus = result.httpStatus ?? 200
      bodyResult = result.bodyText
    } else {
      status = result.kind
      httpStatus = result.httpStatus ?? null
      if (result.kind === 'rate_limited') {
        const delaySec = retryDelaySec('rate_limited', gate.failCount ?? 0, result.retryAfterSec ?? null)
        gate = openGateFor(gate, { now: nowMs, kind: 'rate_limited', delaySec, credentialExpiresAt: chosen.expiresAt })
        retryAtMs = gate.nextAllowedAt
      } else if (result.kind === 'upstream_error') {
        const delaySec = retryDelaySec('upstream_error', gate.failCount ?? 0, result.retryAfterSec ?? null)
        gate = openGateFor(gate, { now: nowMs, kind: 'upstream_error', delaySec, credentialExpiresAt: chosen.expiresAt })
        retryAtMs = gate.nextAllowedAt
      } else if (result.kind === 'auth_required') {
        gate = openGateFor(gate, {
          now: nowMs,
          kind: 'auth_required',
          delaySec: AUTH_REQUIRED_GATE_SEC,
          credentialExpiresAt: chosen.expiresAt,
        })
        retryAtMs = gate.nextAllowedAt
      }
      // network_error는 게이트 없이 다음 주기에 재시도한다(D5).
    }
  }

  if (status === 'ok') gate = resetGate()

  const envelope = buildEnvelope({
    nowMs,
    status,
    called,
    httpStatus,
    retryAtMs,
    credentialExpiresAt: chosen?.expiresAt ?? null,
    bodyText: bodyResult,
    previous: state.previous,
    intervalSec: USAGE_INTERVAL_SEC,
    collectorVersion,
    kvTokenExpiresAt: null,
  })

  if (dryRun) {
    let keys = []
    if (status === 'ok' && envelope.rawText !== null) {
      try {
        keys = Object.keys(JSON.parse(envelope.rawText))
      } catch {
        keys = []
      }
    }
    return {
      exitCode: EXIT_OK,
      dryRunReport: {
        status,
        called,
        keys,
        sha256: envelope.rawText !== null ? sha256Hex(envelope.rawText) : null,
      },
    }
  }

  await ports.state.write({
    schema: 1,
    previous: envelope,
    gate: {
      nextAllowedAt: gate.nextAllowedAt ?? null,
      failReason: gate.failReason ?? null,
      failCount: gate.failCount ?? 0,
      authDeniedExpiresAt: gate.authDeniedExpiresAt ?? null,
    },
    lastRun: { status, tokenExpiresAt: chosen?.expiresAt ?? null },
  })

  let kvResult
  try {
    kvResult = await ports.kv.write(JSON.stringify(envelope))
  } catch (error) {
    kvResult = { ok: false, httpStatus: null, message: `갑작스러운 오류: ${String(error)}` }
  }

  const prevStatus = state.lastRun?.status ?? null
  const prevTokenExpiresAt = state.lastRun?.tokenExpiresAt ?? null
  const newTokenExpiresAt = chosen?.expiresAt ?? null
  await ports.logger.write({
    runAt: envelope.runAt,
    status,
    called,
    httpStatus: envelope.httpStatus,
    tokenExpiresAt: envelope.tokenExpiresAt,
    kvOk: kvResult.ok === true,
    kvReason: kvResult.ok === true ? null : (kvResult.message ?? null),
    transition: prevStatus !== null && prevStatus !== status ? `${prevStatus}→${status}` : null,
    tokenRefreshed:
      prevTokenExpiresAt !== null && newTokenExpiresAt !== null && prevTokenExpiresAt !== newTokenExpiresAt,
  })

  return { exitCode: kvResult.ok === true ? EXIT_OK : EXIT_KV_FAILURE }
}
