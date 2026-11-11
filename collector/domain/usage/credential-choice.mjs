/**
 * 자격 증명 선택(ADR 0.2 D3).
 * Keychain 경로는 제거되었고 파일 읽기(~/.claude/.credentials.json) 하나만 남았지만,
 * 여러 읽기 소스 중 최신 expiresAt을 고르는 규칙은 일반형으로 유지한다.
 */

/** 읽기 결과(null 포함) 중 expiresAt이 가장 늦은 것. 동점이면 목록 순서상 첫째.
 * @typedef {import('./ports.mjs').CredentialRead} CredentialRead
 * @param {Array<CredentialRead|null>} reads 읽기 결과(null은 실패한 읽기)
 * @param {number} _nowMs 사용하지 않는 시각 인자(호출부 시그니처 통일)
 * @returns {CredentialRead|null}
 */
export function chooseCredential(reads, _nowMs) {
  const available = (reads ?? []).filter((read) => read !== null && read !== undefined)
  if (available.length === 0) return null
  let best = available[0]
  for (const read of available) {
    if ((read.expiresAt ?? Number.NEGATIVE_INFINITY) > (best.expiresAt ?? Number.NEGATIVE_INFINITY)) {
      best = read
    }
  }
  return best
}

/**
 * 만료 판정. expiresAt을 모르면 호출해 보고 401로 판정하므로 만료 아님으로 본다.
 * @param {CredentialRead|null|undefined} credential
 * @param {number} nowMs
 * @returns {boolean}
 */
export function credentialExpired(credential, nowMs) {
  if (credential === null || credential === undefined) return false
  if (credential.expiresAt === null || credential.expiresAt === undefined) return false
  return credential.expiresAt < nowMs
}
