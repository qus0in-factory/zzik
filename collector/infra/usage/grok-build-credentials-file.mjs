/**
 * Grok Build 소유 auth.json을 읽기만 한다. 갱신·잠금·파일 쓰기는 CLI의 책임이다.
 * 포트에는 access token과 만료만 전달하며 refresh token·계정 값은 내보내지 않는다.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chooseCredential } from '../../domain/usage/credential-choice.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').CredentialRead} CredentialRead */

export const DEFAULT_GROK_AUTH_PATH = join(homedir(), '.grok', 'auth.json')

/** @param {string} [path] @returns {Promise<CredentialRead|null>} */
export async function readGrokBuildCredentials(path = DEFAULT_GROK_AUTH_PATH) {
  try {
    const json = JSON.parse(await readFile(path, 'utf8'))
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
    /** @type {CredentialRead[]} */
    const reads = []
    for (const [name, value] of Object.entries(json)) {
      if (!name.startsWith('https://auth.x.ai::')) continue
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = /** @type {Record<string, unknown>} */ (value)
      if (typeof entry.key !== 'string' || entry.key.length === 0) continue
      const expiry = typeof entry.expires_at === 'string' ? Date.parse(entry.expires_at) : NaN
      reads.push({ source: 'file', token: entry.key, expiresAt: Number.isFinite(expiry) ? expiry : null })
    }
    // 알려진 만료가 가장 늦은 항목, 동점(모두 미상 포함)이면 파일 순서상 첫째.
    return chooseCredential(reads, 0)
  } catch {
    return null
  }
}
