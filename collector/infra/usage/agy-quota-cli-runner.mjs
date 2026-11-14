import { spawn } from 'node:child_process'

export const DEFAULT_AGY_CLI_TIMEOUT_MS = 15_000
export const DEFAULT_AGY_CLI_KILL_GRACE_MS = 2_000
export const MAX_AGY_CLI_OUTPUT_BYTES = 1_048_576

/**
 * `agy -p /quota`를 실행해 표준 출력을 돌려준다. 실패·타임아웃·비정상 종료·출력 초과는 null.
 * - 자식을 detached 프로세스 그룹으로 띄워 타임아웃 시 그룹 전체에 SIGTERM → grace 뒤 SIGKILL을 보낸다.
 *   (execFile timeout은 SIGTERM만 보내고 close를 기다려, SIGTERM 무시·손자 프로세스가 stdout을 물면 끝나지 않는다.)
 * - 타임아웃이면 close와 무관하게 `timeoutMs + graceMs`에 반드시 resolve(null)한다.
 * - 토큰을 넘기지 않고 stderr는 버린다. stdout은 최대 MAX_AGY_CLI_OUTPUT_BYTES까지만 모은다.
 * @param {{
 *   path?: string,
 *   timeoutMs?: number,
 *   graceMs?: number,
 *   maxOutputBytes?: number,
 *   enabled?: boolean,
 *   spawn?: Function,
 * }} [options]
 * @returns {Promise<string|null>}
 */
export function runAgyQuotaCli({
  path = 'agy',
  timeoutMs = DEFAULT_AGY_CLI_TIMEOUT_MS,
  graceMs = DEFAULT_AGY_CLI_KILL_GRACE_MS,
  maxOutputBytes = MAX_AGY_CLI_OUTPUT_BYTES,
  enabled = true,
  spawn: spawnImpl = spawn,
} = {}) {
  if (!enabled) return Promise.resolve(null)
  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess|null} */
    let child = null
    let settled = false
    let timedOut = false
    /** @type {NodeJS.Timeout|undefined} */
    let timer
    /** @type {NodeJS.Timeout|undefined} */
    let killTimer

    /** @param {string|null} value */
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolve(value)
    }
    /** @param {NodeJS.Signals} signal */
    const killGroup = (signal) => {
      if (child === null || child.pid === undefined) return
      try {
        process.kill(-child.pid, signal)
      } catch {
        // 그룹이 이미 사라졌거나 권한이 없다. 직접 자식만이라도 시도한다.
        try { child.kill(signal) } catch { /* 이미 종료됨 */ }
      }
    }

    try {
      child = spawnImpl(path, ['-p', '/quota'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      finish(null)
      return
    }

    /** @type {Buffer[]} */
    const chunks = []
    let bytes = 0
    const proc = /** @type {import('node:child_process').ChildProcess} */ (child)
    proc.stdout?.on('data', (/** @type {Buffer} */ chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > maxOutputBytes) {
        killGroup('SIGKILL')
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    proc.on('error', () => {
      killGroup('SIGKILL')
      finish(null)
    })
    proc.on('close', (code) => {
      if (timedOut) return // 독립 타이머가 grace 뒤에 resolve한다.
      finish(code === 0 ? Buffer.concat(chunks).toString('utf8') : null)
    })

    timer = setTimeout(() => {
      timedOut = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => {
        killGroup('SIGKILL')
        finish(null)
      }, graceMs)
    }, timeoutMs)
  })
}
