import { spawn as realSpawn, type ChildProcess } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { runAgyQuotaCli } from '../../../../collector/infra/usage/agy-quota-cli-runner.mjs'

const node = process.execPath
const spawnNode = (script: string, options: unknown): ChildProcess => realSpawn(node, ['-e', script], options as never) as ChildProcess
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitDead(pid: number, timeoutMs = 1000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try { process.kill(pid, 0) } catch { return true }
    await sleep(25)
  }
  return false
}

describe('Given the agy quota CLI runner', () => {
  it('When it succeeds Then stdout comes back', async () => {
    const out = await runAgyQuotaCli({
      timeoutMs: 2000,
      spawn: (_path: string, _args: readonly string[] | undefined, options: unknown) => spawnNode("process.stdout.write('Gemini Models\\tWeekly Limit Remaining\\t12%\\t2026-11-14T04:46:03Z')", options),
    })
    expect(out).toBe('Gemini Models\tWeekly Limit Remaining\t12%\t2026-11-14T04:46:03Z')
  })

  it('When it fails or exits non-zero Then null', async () => {
    const out = await runAgyQuotaCli({
      timeoutMs: 2000,
      spawn: (_path: string, _args: readonly string[] | undefined, options: unknown) => spawnNode('process.exit(2)', options),
    })
    expect(out).toBeNull()
  })

  it('When exec throws Then null', async () => {
    expect(await runAgyQuotaCli({ spawn: (() => { throw new Error('ENOENT') }) as never })).toBeNull()
  })

  it('When disabled Then it is not executed', async () => {
    let ran = false
    expect(await runAgyQuotaCli({ enabled: false, spawn: (() => { ran = true; throw new Error('stop') }) as never })).toBeNull()
    expect(ran).toBe(false)
  })

  it('When the child ignores SIGTERM Then the group is SIGKILLed and the promise resolves after the grace period', async () => {
    let pid: number | undefined
    const started = Date.now()
    const out = await runAgyQuotaCli({
      timeoutMs: 100,
      graceMs: 100,
      spawn: (_path: string, _args: readonly string[] | undefined, options: unknown) => {
        const child = spawnNode("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", options)
        pid = child.pid
        return child
      },
    })
    const elapsed = Date.now() - started
    expect(out).toBeNull()
    expect(elapsed).toBeLessThan(1500)
    expect(pid).toBeTypeOf('number')
    expect(await waitDead(pid!)).toBe(true)
  })

  it('When a grandchild keeps stdout open Then the whole group dies and the promise does not wait for close', async () => {
    let parentPid: number | undefined
    let grandchildPid: number | undefined
    const script = `const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'inherit', 'ignore'] })
      process.stdout.write('pid:' + child.pid + '\\n')
      process.on('SIGTERM', () => {})
      setInterval(() => {}, 1000)`
    const started = Date.now()
    const out = await runAgyQuotaCli({
      timeoutMs: 100,
      graceMs: 100,
      spawn: (_path: string, _args: readonly string[] | undefined, options: unknown) => {
        const child = spawnNode(script, options)
        parentPid = child.pid
        child.stdout?.on('data', (chunk: Buffer) => {
          const match = /pid:(\d+)/.exec(String(chunk))
          if (match !== null) grandchildPid = Number(match[1])
        })
        return child
      },
    })
    expect(out).toBeNull()
    expect(Date.now() - started).toBeLessThan(1500)
    expect(parentPid).toBeTypeOf('number')
    expect(grandchildPid).toBeTypeOf('number')
    expect(await waitDead(parentPid!)).toBe(true)
    expect(await waitDead(grandchildPid!)).toBe(true)
  })

  it('When stdout exceeds the limit Then it is killed and null comes back', async () => {
    let pid: number | undefined
    const out = await runAgyQuotaCli({
      timeoutMs: 2000,
      maxOutputBytes: 1024,
      spawn: (_path: string, _args: readonly string[] | undefined, options: unknown) => {
        const child = spawnNode('process.stdout.write("x".repeat(4096))', options)
        pid = child.pid
        return child
      },
    })
    expect(out).toBeNull()
    expect(pid).toBeTypeOf('number')
    expect(await waitDead(pid!)).toBe(true)
  })
})
