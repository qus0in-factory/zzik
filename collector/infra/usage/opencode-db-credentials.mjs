/**
 * OpenCode 자격 증명 DB(opencode.db)에서 제공자 토큰을 읽는다. 읽기 전용이며 토큰을 갱신하지 않는다
 * (갱신 소유자는 OpenCode). `refresh`와 계정 식별자는 꺼내지 않는다.
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_OPENCODE_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

const QUERY = 'SELECT value FROM credential WHERE integration_id = ? ORDER BY time_updated DESC LIMIT 5'

/** 권한 경고는 프로세스당 경로별 1회(매 주기 반복 방지). */
const warnedPaths = new Set()

/** 테스트용: 경고 기억을 지운다. */
export function resetPermissionWarnings() {
  warnedPaths.clear()
}

/** @param {number} ms @returns {Promise<void>} */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {string} path
 * @param {unknown} integrationId
 * @param {(path: string, options: { readOnly: true }) => { prepare(sql: string): { all(...params: unknown[]): unknown[] }, close(): void }} open
 * @returns {Array<{ value?: unknown }>|null} 실패하면 null
 */
function queryRows(path, integrationId, open) {
  let db
  try {
    db = open(path, { readOnly: true })
    return /** @type {Array<{ value?: unknown }>} */ (db.prepare(QUERY).all(integrationId))
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* 닫기 실패는 무시한다 */
    }
  }
}

/** @returns {Promise<(path: string, options: { readOnly: true }) => any>} */
async function defaultOpen() {
  const { DatabaseSync } = await import('node:sqlite')
  return (path, options) => new DatabaseSync(path, options)
}

/**
 * @param {{
 *   path?: string,
 *   integrationId: string,
 *   warn?: (message: string) => void,
 *   open?: (path: string, options: { readOnly: true }) => any,
 *   sleep?: (ms: number) => Promise<void>,
 *   retryDelayMs?: number,
 * }} options
 * @returns {() => Promise<{ source: string, token: string, expiresAt: number|null, accountId: null }|null>}
 */
export function createOpencodeDbCredentialReader({ path = DEFAULT_OPENCODE_DB_PATH, integrationId, warn, open, sleep = defaultSleep, retryDelayMs = 200 }) {
  return async () => {
    const opener = open ?? (await defaultOpen())
    let rows = queryRows(path, integrationId, opener)
    if (rows === null) {
      // 파일 없음·열기 실패·잠김은 1회 재시도한다(0.4 D2와 같은 규칙).
      await sleep(retryDelayMs)
      rows = queryRows(path, integrationId, opener)
    }
    if (rows === null) return null
    for (const row of rows) {
      let parsed
      try {
        parsed = JSON.parse(String(row.value))
      } catch {
        continue
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const token = parsed['access']
      if (typeof token !== 'string' || token.length === 0) continue
      const expires = parsed['expires']
      await warnIfWide(path, warn)
      return {
        source: 'opencode-db:' + integrationId,
        token,
        expiresAt: typeof expires === 'number' && Number.isFinite(expires) ? expires : null,
        accountId: null,
      }
    }
    return null
  }
}

/** @param {string} path @param {((message: string) => void)|undefined} warn */
async function warnIfWide(path, warn) {
  if (warnedPaths.has(path)) return
  try {
    const stats = await stat(path)
    if ((stats.mode & 0o077) !== 0) {
      warnedPaths.add(path)
      warn?.('OpenCode DB 파일 권한이 0600보다 넓다')
    }
  } catch {
    /* 권한 확인 실패는 경고 사항일 뿐이다 */
  }
}
