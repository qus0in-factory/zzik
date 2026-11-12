/** Read-only Antigravity credentials. Never refreshes tokens or returns identity fields. */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { rfc3339Ms } from '../../domain/usage/rfc3339-ms.mjs'

export const DEFAULT_ANTIGRAVITY_AUTH_PATH = join(homedir(), '.gemini', 'antigravity-cli', 'antigravity-oauth-token')

/** @param {number} ms @returns {Promise<void>} */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** @param {string} path @returns {Promise<unknown|null>} */
async function tryParse(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string|undefined} path
 * @param {{ retryDelayMs?: number, sleep?: (ms: number) => Promise<void>, warn?: (message: string) => void }} options
 * @returns {Promise<{ source: string, token: string, expiresAt: number|null, accountId: null }|null>}
 */
export async function readAntigravityCredentials(path = DEFAULT_ANTIGRAVITY_AUTH_PATH, options = {}) {
  const sleep = options.sleep ?? defaultSleep
  const retryDelayMs = options.retryDelayMs ?? 200
  let json = await tryParse(path)
  if (json === null) {
    await sleep(retryDelayMs)
    json = await tryParse(path)
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const record = /** @type {Record<string, unknown>} */ (json)
  const tokens = record['token']
  const tokensObject = tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens)
    ? /** @type {Record<string, unknown>} */ (tokens)
    : null
  const token = tokensObject === null ? undefined : tokensObject['access_token']
  if (typeof token !== 'string' || token.length === 0) return null
  // 파일 권한이 0600보다 넓으면 경고한다(L5). 값의 손상은 없으니 읽기는 계속한다.
  try {
    const stats = await stat(path)
    if ((stats.mode & 0o077) !== 0) options.warn?.(`Antigravity auth 파일 권한이 0600보다 넓다`)
  } catch {
    /* 권한 확인 실패는 경고 사항일 뿐이다 */
  }
  return { source: 'antigravity', token, expiresAt: rfc3339Ms(tokensObject?.['expiry']), accountId: null }
}
