import { describe, expect, it } from 'vitest'
import { keyPaths } from '../../../../collector/domain/usage/key-paths.mjs'

const SAMPLE = {
  rate_limit: {
    primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: 1799 },
    secondary_window: { used_percent: 12 },
    limit_reached: false,
  },
  extra_usage: { used_percent: 5 },
  codes: ['a', { nested: true }],
}

describe('Given the dry-run key path list', () => {
  it('When the response has nested objects then every node path is listed (값은 없다)', () => {
    const paths = keyPaths(SAMPLE)
    expect(paths).toContain('rate_limit')
    expect(paths).toContain('rate_limit.primary_window')
    expect(paths).toContain('rate_limit.limit_reached')
    expect(paths).toContain('extra_usage')
    expect(paths.every((path) => path.length > 0 && /\s|"|\d+:%/.test(path.split('=')[1] ?? '0') === false)).toBe(true)
  })

  it('When a value is an array then it is marked as [] and its elements are still walked', () => {
    const paths = keyPaths(SAMPLE)
    expect(paths).toContain('codes[]')
    expect(paths).toContain('codes[].nested')
  })

  it('When the depth exceeds 4 then deeper nodes are not listed', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } }
    const paths = keyPaths(deep)
    expect(paths).toContain('a.b.c.d')
    expect(paths.join('\n')).not.toContain('e')
  })

  it('When the same path repeats (배열의 원시 원소) then it is listed once', () => {
    const paths = keyPaths({ codes: [1, 2, 3] })
    expect(paths.filter((path) => path === 'codes[]')).toHaveLength(1)
  })

  it('When the input is not an object then the root itself is the single path', () => {
    expect(keyPaths('oops')).toEqual([''])
  })
})
