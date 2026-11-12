/**
 * 수집기의 한 실행(ADR 0.2 D2, 0.3 D3 제공자 인자 추가). 포트를 주입받아 순서대로 진행한다.
 *
 *   게이트·자격 증명 확인 → usage 호출(게이트가 허용할 때만) → 봉투 생성
 *   → 저장소 쓰기 → 성공한 previous 및 게이트 상태 저장 → 로그 한 줄
 *
 * - 자격 증명이 없거나 만료된 것은 정상 상태 중 하나다(종료 코드 0).
 * - KV 쓰기가 실패하면 재시도 루프 없이 0이 아닌 코드로 끝낸다. 로컬 상태가 기준이다.
 * - --dry-run은 상태·KV·로그 어디에도 쓰지 않고 provider, status, 키 경로 목록, 본문 sha256만 되돌린다.
 * - 토큰은 usage 포트에만 흐르고 봉투·상태·KV·로그 어디에도 남지 않는다.
 * - 봉투의 provider는 options.provider 그대로다(ADR 0.3 D5).
 */

import { snapshotChanged } from '../../domain/usage/snapshot-change.mjs'
import { USAGE_COLLECTOR_VERSION } from '../../domain/usage/providers.mjs'
import { chooseCredential, credentialExpired } from '../../domain/usage/credential-choice.mjs'
import { buildEnvelope, sha256Hex } from '../../domain/usage/envelope.mjs'
import { keyPaths } from '../../domain/usage/key-paths.mjs'
import { applyRedactions } from '../../domain/usage/redact.mjs'
import { authRetryDelaySec, retryDelaySec } from '../../domain/usage/backoff.mjs'
import { gateAllowsCall, gateRetryAt, openGateFor, resetGate } from '../../domain/usage/gate.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').CollectorPorts} CollectorPorts */
/** @typedef {import('../../domain/usage/ports.mjs').CollectorState} CollectorState */
/** @typedef {import('../../domain/usage/ports.mjs').UsageStatus} UsageStatus */

export const USAGE_INTERVAL_SEC = 900 /** 조립 루트가 intervalSec 옵션을 안 주면 기본값 */
const EXIT_OK = 0
const EXIT_KV_FAILURE = 3

/** 로컬 상태 파일의 기본 형태(D2 usage-state.json). @returns {CollectorState} */
export function emptyCollectorState() {
  return {
    schema: 1,
    provider: null,
    previous: null,
    gate: { nextAllowedAt: null, failReason: null, failCount: 0, authFailCount: 0, authDeniedExpiresAt: null },
    lastRun: { status: null, tokenExpiresAt: null },
  }
}

/** 상태 파일이 부분적으로만 있거나 오래된 형태일 때 보완한다. @param {any} state @returns {CollectorState} */
function normalizeState(state) {
  const base = emptyCollectorState()
  if (state === null || typeof state !== 'object') return base
  return {
    schema: 1,
    provider: state.provider ?? null,
    previous: state.previous ?? null,
    lastPruneAt: state.lastPruneAt ?? null,
    gate: { ...base.gate, ...(typeof state.gate === 'object' && state.gate !== null ? state.gate : {}) },
    lastRun: {
      status: state.lastRun?.status ?? null,
      tokenExpiresAt: state.lastRun?.tokenExpiresAt ?? null,
    },
  }
}

/**
 * @param {CollectorPorts} ports
 * @param {{ dryRun?: boolean, collectorVersion?: string, provider?: string, sendAccountId?: boolean, redactionPaths?: readonly string[], intervalSec?: number }} options
 * @returns {Promise<{ exitCode: number, dryRunReport?: { provider: string, status: UsageStatus, called: boolean, keys: string[], sha256: string|null, diag: string|null } }>}
 */
export async function runOnce(ports, options = {}) {
  const dryRun = options.dryRun === true
  const collectorVersion = options.collectorVersion ?? USAGE_COLLECTOR_VERSION
  const provider = options.provider ?? 'claude'
  const nowMs = ports.clock.now()
  const state = normalizeState(await ports.state.read())

  // 자격 증명을 먼저 읽는다. 401 게이트의 즉시 해제 판정에 현재 expiresAt이 필요하기 때문이다(D5).
  const reads = await ports.credentials.readAll()
  const chosen = chooseCredential(reads, nowMs)

  const gateDecision = gateAllowsCall(state.gate, nowMs, chosen?.expiresAt ?? undefined)
  let gate = gateDecision.releasedByRefresh === true ? resetGate() : state.gate

  /** @type {UsageStatus} */
  let status
  let called = false
  let httpStatus = null
  let bodyResult = null
  let retryAtMs = null
  let diag = null
  /** @type {string[]|null} */
  let rawRedactedPaths = null
  const accountHeaderWanted = options.sendAccountId === true
  const accountId = accountHeaderWanted ? (chosen?.accountId ?? null) : null

  if (gateDecision.allowed === false) {
    // 게이트로 건너뛴 실행: 하트비트 봉투만 쓴다(D2).
    // previous is the last committed envelope; lastRun also tracks failures whose store write failed.
    status = /** @type {UsageStatus} */ (state.lastRun?.status ?? state.previous?.status ?? 'no_credentials')
    retryAtMs = gateRetryAt(gate)
  } else if (chosen === null) {
    status = 'no_credentials'
  } else if (credentialExpired(chosen, nowMs)) {
    status = 'token_expired'
  } else {
    const result = await ports.usage.fetchUsage(chosen.token, { accountId })
    called = true
    if (result.ok === true) {
      status = 'ok'
      httpStatus = result.httpStatus ?? 200
      // 식별자 가림: 목록이 있을 때만 본문을 고쳐 싣는다(D5). 가린 경로를 봉투에 남긴다.
      const redactionPaths = options.redactionPaths ?? []
      if (redactionPaths.length === 0) {
        bodyResult = result.bodyText
      } else {
        const applied = applyRedactions(result.bodyText, redactionPaths)
        bodyResult = applied.rawText
        rawRedactedPaths = applied.rawRedacted ?? null
      }
    } else {
      status = result.kind
      httpStatus = result.httpStatus ?? null
      diag = result.diag ?? null
      // 인증 거부 분리(D4): expiresAt이 미래면 auth_rejected, 모르면 auth_required.
      if (result.kind === 'auth_required') {
        status = chosen.expiresAt !== null && chosen.expiresAt > nowMs ? 'auth_rejected' : 'auth_required'
      }
      if (result.kind === 'rate_limited') {
        const delaySec = retryDelaySec('rate_limited', gate.failCount ?? 0, result.retryAfterSec ?? null)
        gate = openGateFor(gate, { now: nowMs, kind: 'rate_limited', delaySec, credentialExpiresAt: chosen.expiresAt })
        retryAtMs = gate.nextAllowedAt
      } else if (result.kind === 'upstream_error') {
        const delaySec = retryDelaySec('upstream_error', gate.failCount ?? 0, result.retryAfterSec ?? null)
        gate = openGateFor(gate, { now: nowMs, kind: 'upstream_error', delaySec, credentialExpiresAt: chosen.expiresAt })
        retryAtMs = gate.nextAllowedAt
      } else if (result.kind === 'auth_required') {
        const delaySec = authRetryDelaySec(gate.authFailCount ?? 0)
        gate = openGateFor(gate, {
          now: nowMs,
          kind: 'auth_required',
          delaySec,
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
    intervalSec: options.intervalSec ?? USAGE_INTERVAL_SEC,
    collectorVersion,
    provider: /** @type {'claude'|'codex'|'antigravity'} */ (provider),
    rawRedacted: /** @type {string[]|undefined} */ (rawRedactedPaths ?? undefined),
    kvTokenExpiresAtMs: null,
  })

  if (dryRun) {
    /** @type {string[]} */
    let paths = []
    if (status === 'ok' && envelope.rawText !== null) {
      try {
        paths = keyPaths(JSON.parse(envelope.rawText))
      } catch {
        paths = []
      }
    }
    return {
      exitCode: EXIT_OK,
      dryRunReport: {
        provider,
        status,
        called,
        keys: paths,
        sha256: envelope.rawText !== null ? sha256Hex(envelope.rawText) : null,
        diag: diag ?? null,
      },
    }
  }

  let kvResult
  try {
    kvResult = await ports.store.write(JSON.stringify(envelope), {
      provider, status: envelope.status, runAt: envelope.runAt, fetchedAt: envelope.fetchedAt,
      rawSha256: envelope.rawText === null ? null : sha256Hex(envelope.rawText),
      collectorVersion: envelope.collectorVersion,
      changed: snapshotChanged(state.previous === null ? null : {
        status: state.previous.status, rawSha256: state.previous.rawText === null ? null : sha256Hex(state.previous.rawText),
      }, {status:envelope.status,rawSha256:envelope.rawText === null ? null : sha256Hex(envelope.rawText)}),
    })
  } catch (error) {
    kvResult = { ok: false, httpStatus: null, message: 'StoreWriteError' }
  }

  // Advance the history baseline only after all configured stores acknowledge the write.
  await ports.state.write({
    schema: 1,
    provider,
    previous: kvResult.ok ? envelope : state.previous,
    lastPruneAt: state.lastPruneAt ?? null,
    gate: {
      nextAllowedAt: gate.nextAllowedAt ?? null,
      failReason: gate.failReason ?? null,
      failCount: gate.failCount ?? 0,
      authFailCount: gate.authFailCount ?? 0,
      authDeniedExpiresAt: gate.authDeniedExpiresAt ?? null,
    },
    lastRun: { status, tokenExpiresAt: chosen?.expiresAt ?? null },
  })

  const prevStatus = state.lastRun?.status ?? null
  const prevTokenExpiresAt = state.lastRun?.tokenExpiresAt ?? null
  const newTokenExpiresAt = chosen?.expiresAt ?? null
  await ports.logger.write({
    provider,
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
    diag: called === false ? null : (diag ?? null),
  })

  return { exitCode: kvResult.ok === true ? EXIT_OK : EXIT_KV_FAILURE }
}
