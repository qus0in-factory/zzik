/**
 * Claude 자격 증명 파일 읽기(ADR 0.2 D3).
 * Keychain 경로는 제거되었고 `~/.claude/.credentials.json`(Claude Code 소유, 갱신도 Claude Code가 한다)만 읽는다.
 * 어떤 실패도 null로 바뀌고, 토큰이 오류 메시지로 나오지 않는다.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @typedef {import('../../domain/usage/ports.mjs').CredentialRead} CredentialRead */

export const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json')

/** @param {string|undefined} raw @returns {number|null} */
function expiryToMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * @param {string} [path]
 * @returns {Promise<CredentialRead|null>}
 */
export async function readCredentialsFile(path = DEFAULT_CREDENTIALS_PATH) {
  try {
    const json = JSON.parse(await readFile(path, 'utf8'))
    const oauth = json?.claudeAiOauth
    const token = typeof oauth?.accessToken === 'string' && oauth.accessToken.length > 0 ? oauth.accessToken : null
    if (token === null) return null
    return { source: 'file', token, expiresAt: expiryToMs(oauth?.expiresAt) }
  } catch {
    return null
  }
}
