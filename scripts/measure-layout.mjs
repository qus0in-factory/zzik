// 로딩(스켈레톤)과 정상 화면의 레이아웃 위치를 비교한다(레이아웃 이동 검증). dev 서버 필요(?fixture= 사용).
// 사용: node scripts/measure-layout.mjs [baseUrl=http://localhost:5199] [width=900] [shot접두사]
// 비교 항목: 첫 섹션 h2 top, "사용 창" 소제목 top(스켈레톤에는 자리표시), 첫 카드 top·height. 다르면 종료 코드 1.
import { writeFileSync } from 'node:fs'
import { openPage, sleep } from './lib/cdp.mjs'

const [base = 'http://localhost:5199', width = '900', shotPrefix] = process.argv.slice(2)
const page = await openPage({ width: Number(width), height: 900 })

const probe = `(() => {
  const section = document.querySelector('[data-testid="usage-section-claude"]')
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), height: Math.round(b.height) } }
  const card = section.querySelector('[data-testid="usage-card"], [data-testid="usage-skeleton-card"]')
  const grid = card?.parentElement
  return { title: r(section.querySelector('h2')), gridTop: r(grid)?.top, card: r(card), sectionHeight: r(section)?.height }
})()`

async function shoot(name, fixture) {
  await page.send('Page.navigate', { url: `${base}/?fixture=${fixture}` })
  await sleep(2500)
  const result = await page.evaluate(probe)
  if (shotPrefix) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${shotPrefix}-${name}.png`, Buffer.from(data, 'base64'))
  }
  return result
}

const loading = await shoot('loading', 'loading')
const normal = await shoot('normal', 'normal')
console.log('loading', JSON.stringify(loading))
console.log('normal ', JSON.stringify(normal))
const same = loading.title.top === normal.title.top && loading.gridTop === normal.gridTop && loading.card.top === normal.card.top && loading.card.height === normal.card.height
console.log(same ? 'OK: 제목·카드 top/height 일치' : 'MISMATCH')
page.close()
process.exit(same ? 0 : 1)
