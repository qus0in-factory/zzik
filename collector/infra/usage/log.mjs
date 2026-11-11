/**
 * 로그(ADR 0.2 D2). 실행당 한 줄: 시각, status, called, httpStatus, tokenExpiresAt, KV 결과,
 * 상태 전이(직전 status가 다를 때), token_refreshed(expiresAt이 바뀌었을 때).
 * 토큰 값은 이 모듈이 받는 입력 어디에도 없다(구조적으로 빠져 있다).
 */

import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/** @typedef {import('../../domain/usage/ports.mjs').LogEntry} LogEntry */

/**
 * @param {LogEntry} entry
 * @returns {string}
 */
export function formatLogLine(entry) {
  const parts = [
    entry.runAt,
    `provider=${entry.provider ?? 'unknown'}`,
    `status=${entry.status ?? 'unknown'}`,
    `called=${entry.called ? 1 : 0}`,
    `httpStatus=${entry.httpStatus ?? 'null'}`,
    `tokenExpiresAt=${entry.tokenExpiresAt ?? 'null'}`,
    entry.kvOk ? 'kv=ok' : `kv=fail:${entry.kvReason ?? 'unknown'}`,
  ]
  if (entry.diag) parts.push(`diag=${entry.diag}`)
  if (entry.transition) parts.push(`transition=${entry.transition}`)
  if (entry.tokenRefreshed) parts.push('token_refreshed')
  return parts.join(' ')
}

/**
 * @param {{ path: string }} options
 * @returns {{ write(entry: LogEntry): Promise<void> }}
 */
export function createLogAppender({ path }) {
  return {
    async write(entry) {
      const dir = dirname(path)
      await mkdir(dir, { recursive: true })
      await chmod(dir, 0o700).catch(() => {})
      await appendFile(path, `${formatLogLine(entry)}\n`, { mode: 0o600 })
      await chmod(path, 0o600).catch(() => {})
    },
  }
}
