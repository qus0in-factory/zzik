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
