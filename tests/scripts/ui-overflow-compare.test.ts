import { describe, expect, it } from 'vitest'
import { compareCase } from '../../scripts/lib/ui-overflow-compare.mjs'

describe('Given repeated selectors in a previous measurement', () => {
  it('When corresponding elements are compared Then each occurrence is matched in DOM order', () => {
    const element = (scrollWidth: number) => ({ selector: 'bar', scrollWidth, clientWidth: 100, text: '', lines: 0, height: 10 })
    const base = { name: 'usage', width: 320, innerWidth: 320, documentScrollWidth: 320, elements: [element(110), element(100)] }
    expect(compareCase(base, { ...base, elements: [element(110), element(101)] }).newOverflow).toEqual([element(101)])
    expect(compareCase(base, base).newOverflow).toEqual([])
  })
})
