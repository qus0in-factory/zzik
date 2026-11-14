// vite preview(또는 임의 URL)의 "첫 로드 전송량"을 헤드리스 Chrome(CDP Network, 캐시 끔)로 잰다.
// 사용: node scripts/measure-transfer.mjs <url> [대기ms=6000] [--block=<URL 패턴>]   (보통 pnpm build && pnpm preview --port 4199 후 실행)
//   --block=*cdn.jsdelivr.net* 처럼 패턴을 주면 해당 요청을 막고 잰다(그 리소스가 없을 때의 전송량 = 증가분 계산용).
import { openPage, sleep } from './lib/cdp.mjs'

const block = process.argv.find((arg) => arg.startsWith('--block='))?.slice('--block='.length)
const [url, wait = '6000'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
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
if (block) await page.send('Network.setBlockedURLs', { urls: [block] })
await page.send('Page.navigate', { url })
await sleep(Number(wait))
rows.sort((a, b) => b[0] - a[0])
for (const [bytes, path] of rows.slice(0, 12)) console.log(String(bytes).padStart(9), path)
console.log(`requests ${rows.length}`)
console.log(`TOTAL ${total} bytes (${(total / 1024).toFixed(1)} KB)`)
page.close()
process.exit(0)
