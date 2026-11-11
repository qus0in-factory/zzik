/**
 * 봉투 생성(ADR 0.2 D4).
 * - 성공: fetchedAt을 지금으로, rawText는 본문 원문(64KB 초과 시 null + rawOmitted 'too_large').
 * - 실패·건너뜀: 로컬 상태의 이전 성공 본문(rawText·fetchedAt)을 그대로 싣는다.
 * - httpStatus: 실제로 응답을 받은 이번 실행이면 그 값, 아니면 이전 값 유지.
 * - 토큰은 이 모듈의 입력이 아니다. 봉투 어디에도 남지 않는다.
 */

import { createHash } from 'node:crypto'

const MAX_RAW_BYTES = 64 * 1024

/** dry-run 출력용 본문 지문(V6). @param {string} text @returns {string} */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** @type {'too_large'} */
export const RAW_OMITTED_TOO_LARGE = 'too_large'

/**
 * @typedef {import('./ports.mjs').UsageEnvelope} UsageEnvelope
 * @typedef {import('../../../shared/usage-contract.js').UsageStatus} UsageStatus
 */

/** @param {number|null|undefined} ms @returns {string|null} */
function isoOrNull(ms) {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString()
}

/**
 * @param {{
 *   nowMs: number,
 *   status: UsageStatus,
 *   called: boolean,
 *   httpStatus: number|null,
 *   retryAtMs: number|null,
 *   credentialExpiresAt: number|null,
 *   bodyText: string|null,
 *   previous: UsageEnvelope|null,
 *   intervalSec: number,
 *   collectorVersion: string,
 *   kvTokenExpiresAtMs?: number|null,
 * }} input
 * @returns {UsageEnvelope}
 */
export function buildEnvelope({
  nowMs,
  status,
  called,
  httpStatus,
  retryAtMs,
  credentialExpiresAt,
  bodyText,
  previous,
  intervalSec,
  collectorVersion,
  kvTokenExpiresAtMs = null,
}) {
  const runAt = new Date(nowMs).toISOString()
  const prev = previous ?? null
  const ok = status === 'ok'

  let rawText
  let rawOmitted
  let fetchedAt
  if (ok) {
    const byteLength = Buffer.byteLength(bodyText ?? '', 'utf8')
    const omitted = bodyText !== null && bodyText !== undefined && byteLength > MAX_RAW_BYTES
    rawText = omitted ? null : (bodyText ?? null)
    rawOmitted = omitted ? RAW_OMITTED_TOO_LARGE : null
    fetchedAt = runAt
  } else {
    rawText = prev?.rawText ?? null
    rawOmitted = prev?.rawOmitted ?? null
    fetchedAt = prev?.fetchedAt ?? null
  }

  return {
    schema: 1,
    provider: 'claude',
    status,
    called: Boolean(called),
    runAt,
    fetchedAt,
    httpStatus: called && httpStatus !== null && httpStatus !== undefined ? httpStatus : (prev?.httpStatus ?? null),
    retryAt: isoOrNull(retryAtMs),
    tokenExpiresAt: isoOrNull(credentialExpiresAt),
    kvTokenExpiresAt: isoOrNull(kvTokenExpiresAtMs),
    intervalSec,
    collectorVersion,
    rawText,
    rawOmitted,
  }
}
