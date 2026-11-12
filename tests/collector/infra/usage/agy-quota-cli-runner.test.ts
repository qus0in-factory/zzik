import { describe, expect, it } from 'vitest'
import { runAgyQuotaCli } from '../../../../collector/infra/usage/agy-quota-cli-runner.mjs'

type Cb = (error: Error | null, stdout: string) => void
const fakeExec = (behave: (cb: Cb, args: unknown[]) => void) =>
  ((path: string, args: string[], options: object, cb: Cb) => {
    behave(cb, [path, args, options])
    return { stdin: { end() {} } }
  }) as never

describe('Given the agy quota CLI runner', () => {
  it('When it succeeds Then stdout comes back, run as `agy -p /quota` with a timeout', async () => {
    let seen: unknown[] = []
    const out = await runAgyQuotaCli({ exec: fakeExec((cb, args) => { seen = args; cb(null, 'rows') }), timeoutMs: 123 })
    expect(out).toBe('rows')
    expect(seen).toEqual(['agy', ['-p', '/quota'], expect.objectContaining({ timeout: 123 })])
  })
  it('When it fails or times out Then null', async () => {
    expect(await runAgyQuotaCli({ exec: fakeExec((cb) => cb(new Error('timeout'), '')) })).toBeNull()
  })
  it('When exec throws Then null', async () => {
    expect(await runAgyQuotaCli({ exec: (() => { throw new Error('ENOENT') }) as never })).toBeNull()
  })
  it('When disabled Then it is not executed', async () => {
    let ran = false
    expect(await runAgyQuotaCli({ enabled: false, exec: fakeExec(() => { ran = true }) })).toBeNull()
    expect(ran).toBe(false)
  })
})
