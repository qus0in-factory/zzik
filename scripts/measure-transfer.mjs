// vite preview(또는 임의 URL)의 "첫 로드 전송량"을 헤드리스 Chrome(CDP Network, 캐시 끔)로 잰다.
// 사용: node scripts/measure-transfer.mjs <url> [대기ms=6000]   (보통 pnpm build && pnpm preview --port 4199 후 실행)
import { openPage, sleep } from './lib/cdp.mjs'

const [url, wait = '6000'] = process.argv.slice(2)
if (!url) throw new Error('usage: measure-transfer.mjs <url> [waitMs]')
const page = await openPage()
const urls = new Map()
let total = 0
const rows = []
page.onEvent((event) => {
  if (event.method === 'Network.responseReceived') urls.set(event.params.requestId, event.params.response.url)
  if (event.method === 'Network.loadingFinished') {
    total += event.params.encodedDataLength
    rows.push([event.params.encodedDataLength, (urls.get(event.params.requestId) ?? '?').replace(/^https?:\/\/[^/]+/, '')])
  }
})
await page.send('Network.enable')
await page.send('Network.setCacheDisabled', { cacheDisabled: true })
await page.send('Page.navigate', { url })
await sleep(Number(wait))
rows.sort((a, b) => b[0] - a[0])
for (const [bytes, path] of rows.slice(0, 12)) console.log(String(bytes).padStart(9), path)
console.log(`requests ${rows.length}`)
console.log(`TOTAL ${total} bytes (${(total / 1024).toFixed(1)} KB)`)
page.close()
process.exit(0)
