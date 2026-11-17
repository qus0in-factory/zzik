// README와 소개 페이지용 스크린샷을 고정 픽스처로 갱신한다. `pnpm screenshot:readme`
// - vite dev를 OS가 고른 빈 포트에 띄우고 `?fixture=normal` 화면만 촬영한다(실데이터·계정 없음).
// - 사용량 데스크톱/모바일/차트, 트렌드를 public/screenshots/*.webp로 만들고 README용 데스크톱 PNG도 남긴다.
// - 트렌드는 `/trend?fixture=normal`의 DEV 합성 게이트웨이로 성능 지표·신규·무료·링크를 채운 뒤 촬영한다.
// - 시각을 고정해 리셋 문구가 실행마다 달라지지 않게 한다. 진입 애니메이션이 끝난 뒤 캡처한다.
// - 자기 프로세스(vite·Chrome)만 정리한다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureServer, openPage, sleep } from './lib/cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_OUT = resolve(ROOT, 'docs/screenshots/desktop.png')
const PUBLIC_DIR = resolve(ROOT, 'public/screenshots')
const USAGE_DESKTOP = resolve(PUBLIC_DIR, 'usage-desktop.webp')
const USAGE_MOBILE = resolve(PUBLIC_DIR, 'usage-mobile.webp')
const USAGE_CHART = resolve(PUBLIC_DIR, 'usage-chart.webp')
const TREND = resolve(PUBLIC_DIR, 'trend.webp')
const MAX_PNG_BYTES = 300 * 1024
const MAX_WEBP_BYTES = 250 * 1024
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

/** @param {Awaited<ReturnType<typeof openPage>>} page */
async function navigate(page, url) {
  await page.send('Page.navigate', { url })
  await sleep(200)
  const pageNow = await page.evaluate('Date.now()')
  if (pageNow !== FIXED_NOW_MS) throw new Error(`페이지 시각 고정 실패: ${pageNow}`)
}

/** @param {Awaited<ReturnType<typeof openPage>>} page */
async function waitForUsage(page) {
  for (let i = 0; i < 40; i += 1) {
    const sections = await page.evaluate(`document.querySelectorAll('[data-testid^="usage-section-"]').length`)
    if (sections >= 6) break
    await sleep(100)
  }
  // 진입 애니메이션(페이드인·막대·저빌)이 끝난 뒤에 찍는다.
  await sleep(1600)
}

/** @param {Awaited<ReturnType<typeof openPage>>} page */
async function waitForTrend(page) {
  for (let i = 0; i < 60; i += 1) {
    const ready = await page.evaluate(`(() => {
      const has = (id) => document.querySelector('[data-testid="' + id + '"]') !== null
      return has('trend-metrics-entry') && has('trend-new-model') && has('trend-free-model')
    })()`)
    if (ready) break
    await sleep(100)
  }
  // 진입 애니메이션과 섹션 페이드인이 끝난 뒤에 찍는다.
  await sleep(600)
}

/** @param {Awaited<ReturnType<typeof openPage>>} page @param {'png'|'webp'} format @param {number} quality @param {string} file @param {number} maxBytes @param {{x:number,y:number,width:number,height:number,scale:number}} [clip] */
async function capture(page, format, quality, file, maxBytes, clip) {
  const params = { format, ...(format === 'webp' ? { quality } : {}), ...(clip === undefined ? {} : { clip, captureBeyondViewport: true }) }
  const { data } = await page.send('Page.captureScreenshot', params)
  const buffer = Buffer.from(data, 'base64')
  if (buffer.length > maxBytes) throw new Error(`${relative(ROOT, file)}이(가) ${maxBytes} bytes를 넘습니다: ${buffer.length} bytes`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, buffer)
  console.log(`${relative(ROOT, file)} (${buffer.length} bytes)`)
  return buffer
}

const port = await freePort()
const base = `http://localhost:${port}`
await ensureServer(base)
const page = await openPage({ width: 1280, height: 900 })
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

  await page.setSize(1280, 900)
  await navigate(page, `${base}/usage?fixture=normal`)
  await waitForUsage(page)
  await capture(page, 'png', 100, DOCS_OUT, MAX_PNG_BYTES)
  await capture(page, 'webp', 82, USAGE_DESKTOP, MAX_WEBP_BYTES)

  await page.setSize(390, 844)
  await navigate(page, `${base}/usage?fixture=normal`)
  await waitForUsage(page)
  await capture(page, 'webp', 82, USAGE_MOBILE, MAX_WEBP_BYTES)

  await page.setSize(1280, 900)
  await navigate(page, `${base}/usage?fixture=normal`)
  await waitForUsage(page)
  let clicked = false
  for (let i = 0; i < 60 && !clicked; i += 1) {
    clicked = await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === '차트 보기' && !candidate.disabled)
      if (!button) return false
      button.click()
      return true
    })()`)
    if (!clicked) await sleep(100)
  }
  if (!clicked) throw new Error('차트 열기 버튼을 찾지 못했습니다')
  let chartReady = false
  for (let i = 0; i < 80 && !chartReady; i += 1) {
    chartReady = await page.evaluate(`document.querySelector('#usage-history-claude .chart-canvas-host canvas') !== null`)
    if (!chartReady) await sleep(100)
  }
  if (!chartReady) throw new Error('차트 캔버스가 렌더되지 않았습니다')
  await page.evaluate(`document.querySelector('#usage-history-claude')?.scrollIntoView({ block: 'start' })`)
  await sleep(500)
  await capture(page, 'webp', 82, USAGE_CHART, MAX_WEBP_BYTES)

  await page.setSize(1280, 900)
  await navigate(page, `${base}/trend?fixture=normal`)
  await waitForTrend(page)
  // 900px 뷰포트 아래 빈 공간을 자르고 링크 목록 아래 여백만 남긴다.
  const trendHeight = await page.evaluate(`(() => {
    const links = document.querySelector('[aria-labelledby="trend-links"]')
    return links === null ? 600 : Math.ceil(links.getBoundingClientRect().bottom + window.scrollY + 24)
  })()`)
  await capture(page, 'webp', 82, TREND, MAX_WEBP_BYTES, { x: 0, y: 0, width: 1280, height: trendHeight, scale: 1 })
} finally {
  page.close()
}
process.exit(0)
