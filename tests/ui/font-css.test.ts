import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Given the font setup (실측: 단일 Pretendard woff2 2.06MB가 첫 로드 전송량의 90%)', () => {
  const css = readFileSync('src/ui/index.css', 'utf8')
  it('Then Pretendard comes from the unicode-range dynamic subset, not the single 2MB file', () => {
    expect(css).toContain('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css')
    expect(css).not.toMatch(/PretendardVariable\.woff2/)
  })
  it("Then the sans stack names the dynamic subset's family", () => {
    expect(css).toContain("'Pretendard Variable'")
  })
})

describe('Given the heading font A2z (눈누 projectnoonnu/2601-6@1.0, jsDelivr CDN)', () => {
  const css = readFileSync('src/ui/index.css', 'utf8')
  const html = readFileSync('index.html', 'utf8')
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*'A2z'[^}]*\}/g)].map((match) => match[0])
  it('Then only the used weight (600 SemiBold) is declared, with swap and a percent-encoded Hangul file name', () => {
    expect(faces).toHaveLength(1)
    const [face] = faces
    expect(face).toMatch(/font-weight:\s*600;/)
    expect(face).toContain('font-display: swap')
    expect(face).toContain('https://cdn.jsdelivr.net/gh/projectnoonnu/2601-6@1.0/%EC%97%90%EC%9D%B4%ED%88%AC%EC%A7%80%EC%B2%B4-6SemiBold.woff2')
    expect(face).not.toMatch(/[가-힣]/)
  })
  it('Then headings use the --font-heading token while the body stays on the sans stack', () => {
    expect(css).toMatch(/--font-heading:\s*'A2z',/)
    expect(css).toMatch(/h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*font-family:\s*var\(--font-heading\)/)
    expect(css).toMatch(/body\s*\{[^}]*font-sans/)
  })
  it('Then every heading in the UI is semibold so the single declared weight covers it', () => {
    for (const file of ['src/ui/App.tsx', 'src/ui/usage/UsageDashboard.tsx', 'src/ui/usage/LimitCard.tsx']) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<(?:h[1-4]|Heading)\b[^>]*className="([^"]*)"/g)) expect(match[1]).toContain('font-semibold')
    }
  })
  it('Then the page preconnects to the font CDN', () => {
    expect(html).toMatch(/<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin\s*\/?>/)
  })
})
