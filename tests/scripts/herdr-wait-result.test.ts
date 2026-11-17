import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/herdr-wait-result.mjs is plain ESM checked by vitest
import { readAgentStatus, waitForResult } from '../../scripts/herdr-wait-result.mjs'

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}
interface Call {
  command: string
  args: string[]
}

const SCRIPT = fileURLToPath(new URL('../../scripts/herdr-wait-result.mjs', import.meta.url))

function clock() {
  let t = 1_000
  const sleeps: number[] = []
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      t += ms
    },
  }
}

describe('Given a worker result file and a Herdr agent', () => {
  it('When the result file mtime is newer than the start Then returns without reading the screen', async () => {
    const calls: Call[] = []
    const result = await waitForResult({
      agent: 'sol',
      file: '/tmp/sol.md',
      sinceMs: 100,
      maxWaitMs: 5_000,
      now: () => 1_000,
      sleep: async () => {
        throw new Error('must not wait')
      },
      stat: () => 150,
      execute: async (command: string, args: readonly string[]) => {
        calls.push({ command, args: [...args] })
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ ok: true, reason: 'file_updated', agent: 'sol', file: '/tmp/sol.md' })
    expect(calls).toHaveLength(0)
  })

  it('When the file is unchanged and the agent is idle or done Then returns agent_idle', async () => {
    for (const status of ['idle', 'done']) {
      const time = clock()
      const result = await waitForResult({
        agent: 'z-ds',
        file: '/tmp/ds.md',
        sinceMs: 5_000,
        maxWaitMs: 5_000,
        intervalMs: 500,
        now: time.now,
        sleep: time.sleep,
        stat: () => 100,
        agentStatus: async () => status,
      })
      expect(result).toMatchObject({ ok: true, reason: 'agent_idle' })
      expect(time.sleeps).toHaveLength(0)
    }
  })

  it('When the agent stays working until the max wait Then times out without a timeout command', async () => {
    const time = clock()
    const calls: Call[] = []
    const result = await waitForResult({
      agent: 'sol',
      file: '/tmp/sol.md',
      sinceMs: 5_000,
      maxWaitMs: 1_000,
      intervalMs: 400,
      now: time.now,
      sleep: time.sleep,
      stat: () => null,
      execute: async (command: string, args: readonly string[]) => {
        calls.push({ command, args: [...args] })
        return { exitCode: 0, stdout: JSON.stringify({ result: { agent: { agent_status: 'working' } } }), stderr: 'synthetic-secret' }
      },
    })
    expect(result).toEqual({ ok: false, reason: 'wait_timeout', agent: 'sol', file: '/tmp/sol.md' })
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    expect(calls.every((call) => call.command === 'herdr' && call.args[0] === 'agent' && call.args[1] === 'get')).toBe(true)
    expect(calls.some((call) => call.command === 'timeout')).toBe(false)
    expect(time.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(1_000)
  })

  it('When status is blocked Then keeps waiting until the file updates or time runs out', async () => {
    const time = clock()
    let polls = 0
    const result = await waitForResult({
      agent: 'sol',
      file: '/tmp/sol.md',
      sinceMs: 50,
      maxWaitMs: 500,
      intervalMs: 500,
      now: time.now,
      sleep: time.sleep,
      stat: () => null,
      agentStatus: async () => {
        polls += 1
        return 'blocked'
      },
    })
    expect(result).toMatchObject({ ok: false, reason: 'wait_timeout' })
    expect(polls).toBeGreaterThan(0)
  })

  it('When the agent name or wait is invalid Then does not poll', async () => {
    const result = await waitForResult({
      agent: 'Sol',
      file: '/tmp/sol.md',
      sinceMs: 0,
      maxWaitMs: 10,
      execute: async () => {
        throw new Error('must not execute')
      },
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_arguments' })
    expect(await waitForResult({ agent: 'sol', file: '/tmp/sol.md', sinceMs: 0, maxWaitMs: 0 })).toMatchObject({
      ok: false,
      reason: 'invalid_arguments',
    })
  })
})

describe('Given Herdr agent get JSON', () => {
  it('When the payload has agent_status Then only that state is returned', () => {
    const stdout = JSON.stringify({ result: { agent: { agent_status: 'done', cwd: '/secret', terminal_title: 'synthetic-secret' } } })
    expect(readAgentStatus(stdout)).toBe('done')
    expect(readAgentStatus('not-json')).toBeNull()
    expect(readAgentStatus(JSON.stringify({ result: { agent: { name: 'sol' } } }))).toBeNull()
  })
})

describe('Given the wait CLI', () => {
  it('When arguments are missing Then exits 64 without running herdr', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--agent', 'sol'], { encoding: 'utf8' })
    expect(result.status).toBe(64)
    expect(result.stdout).toContain('invalid_arguments')
    expect(`${result.stdout}${result.stderr}`).not.toContain('herdr agent')
  })
})
