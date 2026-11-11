/**
 * Codex 자격 증명 읽기(ADR 0.3 D2). `~/.codex/auth.json`을 읽기 전용으로 읽어
 * tokens.access_token 하나만 꺼내고, 만료는 JWT exp로만 판단한다(jwt-exp.mjs).
 * refresh_token·id_token·OPENAI_API_KEY·account_id는 어디에도 넘기지 않는다.
 * JSON 파싱 실패는 200ms 뒤 한 번 다시 읽는다(Codex가 파일을 쓰는 중일 수 있다).
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseJwtExpiredAt } from '../../domain/usage/jwt-exp.mjs'

export const DEFAULT_CODEX_AUTH_PATH = join(homedir(), '.codex', 'auth.json')

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
 * @param {string|undefined} path auth.json 경로
 * @param {{ retryDelayMs?: number, sleep?: (ms: number) => Promise<void> }} options 재시도 대기 주입(테스트)
 * @returns {Promise<{ source: string, token: string, expiresAt: number|null }|null>}
 */
/**
 * @param {string|undefined} path auth.json 경로
 * @param {{ retryDelayMs?: number, sleep?: (ms: number) => Promise<void> }} options 재시도 대기 주입(테스트)
 * @returns {Promise<{ source: string, token: string, expiresAt: number|null }|null>}
 */
export async function readCodexCredentials(path = DEFAULT_CODEX_AUTH_PATH, options = {}) {
  const sleep = options.sleep ?? defaultSleep
  const retryDelayMs = options.retryDelayMs ?? 200
  let json = await tryParse(path)
  if (json === null) {
    await sleep(retryDelayMs)
    json = await tryParse(path)
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const record = /** @type {Record<string, unknown>} */ (json)
  if (record['auth_mode'] === 'apikey') return null // API 키로는 WHAM을 쓸 수 없다(D2)
  const tokens = record['tokens']
  const tokensObject = tokens !== null && typeof tokens === 'object' && !Array.isArray(tokens)
    ? /** @type {Record<string, unknown>} */ (tokens)
    : null
  const token = tokensObject === null ? undefined : tokensObject['access_token']
  if (typeof token !== 'string' || token.length === 0) return null
  return { source: 'codex', token, expiresAt: parseJwtExpiredAt(token) }
}
