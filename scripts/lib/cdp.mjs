// 헤드리스 Chrome을 띄워 DevTools 프로토콜(CDP)로 제어하는 최소 헬퍼(측정 스크립트 공용).
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

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
  if (!(await alive())) {
    throw new Error(`vite dev 서버를 시작하지 못했습니다(${baseUrl}). 포트 ${port}가 이미 사용 중이거나 서버가 응답하지 않습니다.`)
  }
}

/** Chrome이 --remote-debugging-port=0으로 고른 포트를 DevToolsActivePort 파일에서 읽는다. */
async function waitForDevToolsPort(profile) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const [line] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')
      if (line) return Number(line)
    } catch {
      /* 아직 파일이 없다 */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Chrome DevTools 포트를 찾지 못했습니다. CHROME_PATH와 실행 권한을 확인하세요.')
}

export async function openPage({ width = 900, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'zzik-cdp-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  cleanups.add(() => { if (chrome.exitCode === null) chrome.kill() })
  const port = await waitForDevToolsPort(profile)
  let targets
  for (let i = 0; i < 40 && !targets; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((res) => res.json()).catch(() => undefined)
  }
  if (!targets) throw new Error(`Chrome DevTools(포트 ${port})에 연결하지 못했습니다.`)
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
    close: () => { ws.close(); if (chrome.exitCode === null) chrome.kill() },
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
