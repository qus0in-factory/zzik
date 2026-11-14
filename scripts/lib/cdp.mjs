// 헤드리스 Chrome을 띄워 DevTools 프로토콜(CDP)로 제어하는 최소 헬퍼(측정 스크립트 공용).
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** 이전 실행이 남긴 디버깅 포트 점유 프로세스를 정리한다(비정상 종료로 포트가 남으면 다음 실행이 오염된다). */
function freePort(port) {
  try {
    execSync(`lsof -ti tcp:${port} | xargs kill 2>/dev/null`, { stdio: 'ignore' })
  } catch {
    /* 점유 프로세스 없음 */
  }
}

const cleanups = new Set()
function runCleanups() {
  for (const cleanup of cleanups) {
    try { cleanup() } catch { /* 이미 종료됨 */ }
  }
  cleanups.clear()
}
process.on('exit', runCleanups)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { runCleanups(); process.exit(130) })

/** baseUrl이 응답하지 않으면 vite dev 서버를 직접 띄우고, 종료 시(정상·비정상 모두) 함께 정리한다. */
export async function ensureServer(baseUrl) {
  const alive = () => fetch(baseUrl).then((res) => res.ok).catch(() => false)
  if (await alive()) return
  const port = new URL(baseUrl).port
  const server = spawn('pnpm', ['vite', '--port', port, '--strictPort'], { stdio: 'ignore', detached: true })
  cleanups.add(() => process.kill(-server.pid))
  for (let i = 0; i < 40 && !(await alive()); i += 1) await new Promise((resolve) => setTimeout(resolve, 250))
}

export async function openPage({ port = 9333, width = 900, height = 900 } = {}) {
  freePort(port)
  const profile = mkdtempSync(join(tmpdir(), 'zzik-cdp-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  cleanups.add(() => chrome.kill())
  let targets
  for (let i = 0; i < 40 && !targets; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((res) => res.json()).catch(() => undefined)
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve) => (ws.onopen = resolve))
  let id = 0
  const waiting = new Map()
  const listeners = []
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id !== undefined) waiting.get(data.id)?.(data.result)
    else for (const listener of listeners) listener(data)
  }
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })) })
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  return {
    send,
    setSize: (w, h = height) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }),
    onEvent: (listener) => listeners.push(listener),
    evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value,
    close: () => { ws.close(); chrome.kill() },
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
