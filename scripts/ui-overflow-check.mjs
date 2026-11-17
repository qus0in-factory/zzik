// 고정 fixture 화면의 가로 넘침과 텍스트 줄 수를 JSON으로 기록한다.
// 사용: node scripts/ui-overflow-check.mjs [base URL] [output prefix] [baseline JSON]
import { writeFileSync, readFileSync } from 'node:fs'
import { openPage, sleep } from './lib/cdp.mjs'
import { compareCase } from './lib/ui-overflow-compare.mjs'

const base = process.argv[2] ?? 'http://localhost:5173'
const prefix = process.argv[3] ?? '/tmp/keepall'
const baseline = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null
const cases = [ ['home', '/'], ['normal', '/usage?fixture=normal'], ['warn', '/usage?fixture=warn'], ['limited', '/usage?fixture=limited'], ['unknown', '/usage?fixture=unknown-keys'], ['chart', '/usage?fixture=normal'], ['trend', '/trend'] ]
const widths = [1280, 768, 390, 320]
const page = await openPage({ width: 1280, height: 900 })
const results = []
try {
  await page.send('Page.enable')
  const trendFixtures = Object.fromEntries(['metrics', 'new-models', 'free-models'].map(name => [name, readFileSync(new URL(`../tests/fixtures/trend/${name}.payload.json`, import.meta.url)).toString('base64')]))
  page.onEvent(event => {
    if (event.method !== 'Fetch.requestPaused') return
    const section = new URL(event.params.request.url).pathname.split('/').at(-1)
    const body = trendFixtures[section]
    if (body) void page.send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body })
    else void page.send('Fetch.continueRequest', { requestId: event.params.requestId })
  })
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/pub/trend/*' }] })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { localStorage.clear(); sessionStorage.clear(); const RealDate = Date; class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [${Date.UTC(2026,10,14,3)}])) } static now() { return ${Date.UTC(2026,10,14,3)} } } window.Date = FixedDate; const style = document.createElement('style'); style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} ${process.env.BASELINE_WORD_BREAK === 'normal' ? 'body{word-break:normal!important}' : ''}'; document.addEventListener('DOMContentLoaded', () => document.head.append(style)); })()` })
  for (const [name, path] of cases.filter(([name]) => !process.env.CASE || name === process.env.CASE)) for (const width of widths) {
    await page.setSize(width, 900)
    await page.send('Page.navigate', { url: new URL(path, base).href })
    const ready = name === 'home' ? '!!document.querySelector("main")' : name === 'trend' ? 'document.body.textContent.includes("Claude Fable 5.2")' : 'document.querySelectorAll("[data-testid^=usage-section-]").length >= 6'
    for (let i = 0; i < 80 && !(await page.evaluate(ready)); i++) await sleep(100)
    if (!(await page.evaluate(ready))) throw new Error(`화면 준비 실패: ${name} ${width}`)
    await sleep(500)
    if (name === 'chart') {
      const clicked = await page.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === '차트 보기' && !x.disabled); if (!b) return false; b.click(); return true })()`)
      if (!clicked) throw new Error(`차트 버튼 없음: ${width}`)
      for (let i = 0; i < 80 && !(await page.evaluate(`!!document.querySelector('#usage-history-claude canvas')`)); i++) await sleep(100)
      if (!(await page.evaluate(`!!document.querySelector('#usage-history-claude canvas')`))) throw new Error(`차트 미렌더: ${width}`)
      for (let i = 0; i < 80 && await page.evaluate(`!!document.querySelector('.usage-history-panel [aria-busy=\"true\"]')`); i++) await sleep(100)
      if (await page.evaluate(`!!document.querySelector('.usage-history-panel [aria-busy=\"true\"]')`)) throw new Error(`열린 차트 로딩 중: ${width}`)
    }
    const data = await page.evaluate(`(() => {
      const selector = el => { const parts=[]; for (let node=el; node && node.nodeType===1; node=node.parentElement) { let part=node.tagName.toLowerCase(); if(node.id){parts.unshift(part+'#'+CSS.escape(node.id)); break} if(node.dataset.testid && document.querySelectorAll('[data-testid=\"'+CSS.escape(node.dataset.testid)+'\"]').length === 1){parts.unshift(part+'[data-testid=\"'+CSS.escape(node.dataset.testid)+'\"]'); break} const siblings=node.parentElement ? [...node.parentElement.children].filter(x=>x.tagName===node.tagName) : []; if(siblings.length>1) part += ':nth-of-type('+(siblings.indexOf(node)+1)+')'; parts.unshift(part) } return parts.join(' > ') };
      const elements=[...document.querySelectorAll('body *')].filter(el => { const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && el.clientWidth>0 && getComputedStyle(el).visibility !== 'hidden' }).map(el=>{const s=getComputedStyle(el), r=el.getBoundingClientRect(), text=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').replace(/\\s+/g,' ').trim(); const range=document.createRange(); let lines=0; if(text){range.selectNodeContents(el); lines=new Set([...range.getClientRects()].map(x=>Math.round(x.top))).size} return {selector:selector(el), text:text.slice(0,100), width:Math.round(r.width), height:Math.round(r.height), clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, lines, overflowX:s.overflowX, overflowKind: ['auto','scroll'].includes(s.overflowX) ? 'scroll' : ['hidden','clip'].includes(s.overflowX) ? 'clip' : 'visible'} });
      return {innerWidth, documentScrollWidth:document.documentElement.scrollWidth, elements}; })()`)
    const { data: png } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(`${prefix}-${name}-${width}.png`, Buffer.from(png, 'base64'))
    results.push({ name, path, width, ...data })
    console.log(`${name} ${width}: document ${data.documentScrollWidth}, element overflows ${data.elements.filter(e => e.scrollWidth > e.clientWidth).length}`)
  }
} finally { page.close() }
const comparison = []
if (baseline) for (const current of results) {
  const before = baseline.results.find(x => x.name === current.name && x.width === current.width)
  if (!before) continue
  comparison.push(compareCase(before, current))
}
writeFileSync(`${prefix}.json`, JSON.stringify({ base, fixedNow: '2026-11-14T03:00:00Z', trendFixtures: 'tests/fixtures/trend/{metrics,new-models,free-models}.payload.json via CDP', results, comparison }, null, 2))
