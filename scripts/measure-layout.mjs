// 로딩(스켈레톤)과 정상 화면의 레이아웃 위치를 폭별·보기 방식별(카드·목록)로 비교한다(레이아웃 이동 검증) + 768px 이상에서 칩 줄이 한 줄인지 확인.
// 사용: node scripts/measure-layout.mjs [baseUrl=http://localhost:5199] [shot접두사]
//   baseUrl이 응답하지 않으면 vite dev 서버를 직접 띄우고 끝나면(비정상 종료 포함) 정리한다. 폭: 390·768·1024·1280.
// 비교 항목: 칩 줄 top/height, 첫 섹션 h2 top, 격자·첫 카드 top·height. 다르거나 칩 줄이 한 줄이 아니면 종료 코드 1.
import { writeFileSync } from 'node:fs'
import { ensureServer, openPage, sleep } from './lib/cdp.mjs'

const [base = 'http://localhost:5199', shotPrefix] = process.argv.slice(2)
const WIDTHS = [390, 768, 1024, 1280]
const MODES = ['grid', 'list'] // localStorage zzik:view-mode:v1

const probe = `(() => {
  const section = document.querySelector('[data-testid="usage-section-claude"]')
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), height: Math.round(b.height) } }
  const card = section.querySelector('[data-testid="usage-card"], [data-testid="usage-skeleton-card"], [data-testid="usage-row"], [data-testid="usage-skeleton-row"]')
  const list = document.querySelector('nav[aria-label="제공자별 사용 페이스"] ul')
  const chips = [...list.children]
  const tops = new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)))
  return { chipRow: r(list), chipRows: tops.size, chipCount: chips.length, chipOverflow: list.scrollWidth > list.clientWidth, chipWidth: Math.round(chips.at(-1).getBoundingClientRect().right - chips[0].getBoundingClientRect().left), title: r(section.querySelector('h2'))?.top, titleRow: r(section.querySelector('h2')?.parentElement?.parentElement), gridTop: r(card?.parentElement)?.top, groupTop: r(card?.closest('table')?.parentElement ?? card?.closest('[data-testid="usage-skeleton-list"], [data-testid="usage-skeleton-grid"], [data-testid^="usage-grid-"]'))?.top, card: r(card) }
})()`

let failed = false
try {
  await ensureServer(base)
  const page = await openPage({ width: WIDTHS[0], height: 900 })
  try {
    for (const mode of MODES) for (const width of WIDTHS) {
      await page.setSize(width)
      const shoot = async (name, fixture) => {
        await page.send('Page.navigate', { url: `${base}/?fixture=${fixture}` })
        await sleep(600)
        await page.evaluate(`localStorage.setItem('zzik:view-mode:v1', JSON.stringify({ version: 1, mode: '${mode}' }))`)
        await page.send('Page.navigate', { url: `${base}/?fixture=${fixture}` })
        await sleep(2500)
        const result = await page.evaluate(probe)
        if (shotPrefix) {
          const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
          writeFileSync(`${shotPrefix}-${mode}-${name}-${width}.png`, Buffer.from(data, 'base64'))
        }
        return result
      }
      const loading = await shoot('loading', 'loading')
      const normal = await shoot('normal', 'normal')
      const tag = `[${mode} ${width}px]`
      console.log(`${tag} loading`, JSON.stringify(loading))
      console.log(`${tag} normal `, JSON.stringify(normal))
      const same = (mode === 'list' ? ['title', 'groupTop'] : ['title', 'gridTop', 'groupTop']).every((key) => loading[key] === normal[key]) && loading.chipRow.top === normal.chipRow.top && loading.chipRow.height === normal.chipRow.height && loading.titleRow.height === normal.titleRow.height && loading.card.top === normal.card.top && loading.card.height === normal.card.height
      const oneLine = width < 768 || (loading.chipRows === 1 && normal.chipRows === 1 && !normal.chipOverflow && normal.chipCount === 6)
      console.log(same && oneLine ? `${tag} OK` : `${tag} MISMATCH${same ? '' : ' (위치·높이 불일치)'}${oneLine ? '' : ' (칩 6개가 한 줄에 다 들어가지 않음)'}`)
      if (!same || !oneLine) failed = true
    }
  } finally {
    page.close()
  }
} finally {
  process.exitCode = failed ? 1 : 0
}
process.exit(failed ? 1 : 0)
