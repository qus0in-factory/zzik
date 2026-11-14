// 헤드리스 Chrome을 띄워 DevTools 프로토콜(CDP)로 제어하는 최소 헬퍼(측정 스크립트 공용).
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export async function openPage({ port = 9333, width = 900, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'zzik-cdp-'))
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
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
    onEvent: (listener) => listeners.push(listener),
    evaluate: async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value,
    close: () => { ws.close(); chrome.kill() },
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
