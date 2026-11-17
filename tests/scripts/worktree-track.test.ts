import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/worktree-track.mjs is plain ESM checked by vitest
import { resolveWorktreeBranch, runWorktreeTrack } from '../../scripts/worktree-track.mjs'

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}
interface ExecOptions {
  cwd?: string
  timeoutMs?: number
}
interface Call {
  command: string
  args: string[]
  cwd?: string
}
type Handler = (command: string, args: readonly string[], options?: ExecOptions) => Partial<ExecResult> | undefined

function makeExecutor(handler: Handler = () => undefined) {
  const calls: Call[] = []
  const execute = async (command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], cwd: options?.cwd })
    const override = handler(command, args, options) ?? {}
    return { exitCode: 0, stdout: '', stderr: '', ...override }
  }
  return { calls, execute }
}

const SCRIPT = fileURLToPath(new URL('../../scripts/worktree-track.mjs', import.meta.url))
const runCli = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

describe('Given a worktree track command', () => {
  it('When create is a dry-run Then plans worktree add from dev and runs nothing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zzik-track-'))
    const { calls, execute } = makeExecutor(() => {
      throw new Error('dry-run must not execute commands')
    })
    try {
      const result = await runWorktreeTrack({ action: 'create', track: 'usage', version: '0.7', cwd, execute })
      expect(result).toMatchObject({ ok: true, dryRun: true, action: 'create', track: 'usage', version: '0.7' })
      expect(calls).toHaveLength(0)
      expect(result.steps).toEqual([
        {
          name: 'worktree_add',
          status: 'PLAN',
          command: ['git', 'worktree', 'add', resolve(cwd, '.worktree/usage'), '-b', '0.7/usage', 'dev'],
        },
      ])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('When create --apply is selected Then adds the worktree and does not push', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zzik-track-'))
    const { calls, execute } = makeExecutor()
    try {
      const result = await runWorktreeTrack({ action: 'create', track: 'usage', version: '0.6.28', cwd, apply: true, execute })
      expect(result).toMatchObject({ ok: true, dryRun: false })
      expect(calls).toEqual([
        {
          command: 'git',
          args: ['worktree', 'add', resolve(cwd, '.worktree/usage'), '-b', '0.6.28/usage', 'dev'],
          cwd,
        },
      ])
      expect(calls.some((call) => call.args.includes('push'))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('When the track or version is unsafe Then rejects before any command', async () => {
    const { calls, execute } = makeExecutor()
    for (const track of ['../usage', 'Usage', 'a/b', '', '.worktree']) {
      const result = await runWorktreeTrack({ action: 'create', track, version: '0.7', execute })
      expect(result).toMatchObject({ ok: false, reason: 'invalid_track' })
    }
    expect(await runWorktreeTrack({ action: 'create', track: 'usage', version: 'v0.7', execute })).toMatchObject({
      ok: false,
      reason: 'invalid_version',
    })
    expect(calls).toHaveLength(0)
  })

  it('When merge is a dry-run Then plans a no-ff merge onto dev and runs nothing', async () => {
    const { calls, execute } = makeExecutor(() => {
      throw new Error('dry-run must not execute commands')
    })
    const result = await runWorktreeTrack({ action: 'merge', track: 'usage', message: 'Merge usage', execute })
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(calls).toHaveLength(0)
    expect(result.steps.map((step: { name: string }) => step.name)).toEqual(['branch_dev', 'worktree_clean', 'resolve_branch', 'merge'])
    expect(result.steps.find((step: { name: string }) => step.name === 'merge').command).toEqual([
      'git',
      'merge',
      '--no-ff',
      '-m',
      'Merge usage',
    ])
  })

  it('When merge --apply finds the track branch on dev Then merges with --no-ff and does not push', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zzik-track-'))
    const path = resolve(cwd, '.worktree/usage')
    const porcelain = `worktree ${cwd}\nHEAD abc\nbranch refs/heads/dev\n\nworktree ${path}\nHEAD def\nbranch refs/heads/0.7/usage\n`
    const { calls, execute } = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'dev\n' }
      if (command === 'git' && args[0] === 'status') return { stdout: '' }
      if (command === 'git' && args[0] === 'worktree') return { stdout: porcelain }
      return { stdout: '' }
    })
    try {
      const result = await runWorktreeTrack({ action: 'merge', track: 'usage', message: 'Merge usage', cwd, apply: true, execute })
      expect(result).toMatchObject({ ok: true, dryRun: false, branch: '0.7/usage' })
      expect(calls.at(-1)).toEqual({ command: 'git', args: ['merge', '--no-ff', '-m', 'Merge usage', '0.7/usage'], cwd })
      expect(calls.some((call) => call.args.includes('push'))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('When dev is not current, the tree is dirty, or the message is missing Then stops before merge', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zzik-track-'))
    const notDev = makeExecutor((command, args) => (command === 'git' && args[0] === 'rev-parse' ? { stdout: 'main\n' } : undefined))
    try {
      const result = await runWorktreeTrack({ action: 'merge', track: 'usage', message: 'Merge usage', cwd, apply: true, execute: notDev.execute })
      expect(result).toMatchObject({ ok: false, reason: 'branch_not_dev', failedStep: 'branch_dev' })
      expect(notDev.calls.some((call) => call.args[0] === 'merge')).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }

    const dirty = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'dev\n' }
      if (command === 'git' && args[0] === 'status') return { stdout: ' M README.md\n' }
      return undefined
    })
    const dirtyResult = await runWorktreeTrack({
      action: 'merge',
      track: 'usage',
      message: 'Merge usage',
      cwd,
      apply: true,
      execute: dirty.execute,
    })
    expect(dirtyResult).toMatchObject({ ok: false, reason: 'worktree_dirty', failedStep: 'worktree_clean' })
    expect(dirty.calls.some((call) => call.args[0] === 'merge')).toBe(false)

    const { calls, execute } = makeExecutor()
    expect(await runWorktreeTrack({ action: 'merge', track: 'usage', apply: true, execute })).toMatchObject({
      ok: false,
      reason: 'message_required',
    })
    expect(calls).toHaveLength(0)
  })

  it('When remove is requested Then plans or removes only that worktree path', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zzik-track-'))
    const path = resolve(cwd, '.worktree/usage')
    const dry = makeExecutor(() => {
      throw new Error('dry-run must not execute commands')
    })
    try {
      const planned = await runWorktreeTrack({ action: 'remove', track: 'usage', cwd, execute: dry.execute })
      expect(planned.steps).toEqual([{ name: 'worktree_remove', status: 'PLAN', command: ['git', 'worktree', 'remove', path] }])
      const { calls, execute } = makeExecutor()
      const applied = await runWorktreeTrack({ action: 'remove', track: 'usage', cwd, apply: true, execute })
      expect(applied).toMatchObject({ ok: true, dryRun: false })
      expect(calls).toEqual([{ command: 'git', args: ['worktree', 'remove', path], cwd }])
      expect(calls[0]?.args.includes('--force')).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('When porcelain lists the track Then the branch is the refs/heads name and a detached worktree is rejected', () => {
    const path = '/repo/.worktree/usage'
    const text = `worktree /repo\nbranch refs/heads/dev\n\nworktree ${path}\nbranch refs/heads/0.7/usage\n`
    expect(resolveWorktreeBranch(text, path, 'usage')).toEqual({ ok: true, branch: '0.7/usage' })
    expect(resolveWorktreeBranch(`worktree ${path}\ndetached\n`, path, 'usage')).toMatchObject({ ok: false, reason: 'worktree_detached' })
    expect(resolveWorktreeBranch('', path, 'usage')).toMatchObject({ ok: false, reason: 'worktree_missing' })
  })
})

describe('Given the worktree track CLI', () => {
  it('When help or a missing message is requested Then it exits before git and prints no command output', () => {
    const help = runCli(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--apply')
    expect(help.stdout).toContain('dry-run')
    const missing = runCli(['merge', 'usage', '--apply'])
    expect(missing.status).toBe(64)
    expect(missing.stdout).toContain('message_required')
  })
})
