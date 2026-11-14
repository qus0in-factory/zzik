// README 첫 화면 스크린샷을 고정 픽스처로 갱신한다. `pnpm screenshot:readme`
// - vite dev를 OS가 고른 빈 포트에 띄우고 `?fixture=normal`만 사용한다(실데이터·계정 없음).
// - 시각을 고정해 리셋 문구가 실행마다 달라지지 않게 한다. 진입 애니메이션이 끝난 뒤 캡처한다.
// - 자기 프로세스(vite·Chrome)만 정리한다. 결과는 docs/screenshots/desktop.png, 300KB 이하.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureServer, openPage, sleep } from './lib/cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'docs/screenshots/desktop.png')
const WIDTH = 1280
const HEIGHT = 900
const MAX_BYTES = 300 * 1024
const FIXED_NOW_MS = Date.UTC(2026, 10, 14, 3, 0, 0)

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, 'localhost', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolvePort(port) : reject(new Error('빈 포트를 얻지 못했습니다'))))
    })
  })
}

const port = await freePort()
const base = `http://localhost:${port}`
await ensureServer(base)
const page = await openPage({ width: WIDTH, height: HEIGHT })
try {
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const RealDate = Date
      const fixed = ${FIXED_NOW_MS}
      class FixedDate extends RealDate {
        constructor(...args) { super(...(args.length === 0 ? [fixed] : args)) }
        static now() { return fixed }
      }
      window.Date = FixedDate
    })()`,
  })
  await page.send('Page.navigate', { url: `${base}/?fixture=normal` })
  await sleep(200)
  const pageNow = await page.evaluate('Date.now()')
  if (pageNow !== FIXED_NOW_MS) throw new Error(`페이지 시각 고정 실패: ${pageNow}`)
  for (let i = 0; i < 40; i += 1) {
    const sections = await page.evaluate(`document.querySelectorAll('[data-testid^="usage-section-"]').length`)
    if (sections >= 6) break
    await sleep(100)
  }
  // 진입 애니메이션(페이드인·막대·저빌)이 끝난 뒤에 찍는다.
  await sleep(1600)
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  const png = Buffer.from(data, 'base64')
  if (png.length > MAX_BYTES) throw new Error(`스크린샷이 300KB를 넘습니다: ${png.length} bytes`)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, png)
  console.log(`docs/screenshots/desktop.png (${png.length} bytes)`)
} finally {
  page.close()
}
process.exit(0)
