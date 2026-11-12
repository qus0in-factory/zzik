import { execFile } from 'node:child_process'

export const DEFAULT_AGY_CLI_TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 1_048_576

/**
 * `agy -p /quota`를 실행해 표준 출력을 돌려준다. 실패·타임아웃·비정상 종료는 null(Argon 카드만 생략된다).
 * 토큰을 넘기지 않고 stderr는 버린다. 수집 주기마다 호출 1회(캐시는 주기 단위).
 * @param {{ path?: string, timeoutMs?: number, enabled?: boolean, exec?: typeof execFile }} [options]
 * @returns {Promise<string|null>}
 */
export function runAgyQuotaCli({ path = 'agy', timeoutMs = DEFAULT_AGY_CLI_TIMEOUT_MS, enabled = true, exec = execFile } = {}) {
  if (!enabled) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const child = exec(path, ['-p', '/quota'], { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }, (error, stdout) => {
        resolve(error ? null : String(stdout))
      })
      child.stdin?.end()
    } catch {
      resolve(null)
    }
  })
}
