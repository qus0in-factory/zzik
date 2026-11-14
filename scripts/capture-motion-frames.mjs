// 첫 로드 진입 연출을 정해진 시각(ms)의 프레임으로 캡처한다(시연용).
// 카드가 나타난 직후 모든 CSS 애니메이션을 멈추고 currentTime을 지정해 결정적인 프레임을 얻는다.
// 사용: node scripts/capture-motion-frames.mjs [baseUrl=http://localhost:5199] [출력접두사=/tmp/motion] [시각ms...=0 400 1200]
import { writeFileSync } from 'node:fs'
import { ensureServer, openPage, sleep } from './lib/cdp.mjs'

const [base = 'http://localhost:5199', prefix = '/tmp/motion', ...times] = process.argv.slice(2)
const frames = times.length > 0 ? times.map(Number) : [0, 400, 1200]
await ensureServer(base)
const page = await openPage({ width: 900, height: 620 })
try {
  await page.send('Page.navigate', { url: `${base}/?fixture=normal` })
  for (let i = 0; i < 100 && !(await page.evaluate("!!document.querySelector('[data-testid=\"usage-card\"]')")); i += 1) await sleep(30)
  for (const time of frames) {
    await page.evaluate(`document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${time} })`)
    await sleep(120)
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${prefix}-${time}ms.png`, Buffer.from(data, 'base64'))
  }
} finally {
  page.close()
}
process.exit(0)
