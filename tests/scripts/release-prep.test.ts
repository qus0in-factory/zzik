import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/release-prep.mjs is plain ESM checked by vitest
import { nextPatchVersion, runReleasePrep } from '../../scripts/release-prep.mjs'

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface ExecOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

interface Call {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
}

type Handler = (command: string, args: readonly string[], options?: ExecOptions) => Partial<ExecResult> | undefined

interface ReleaseStep {
  name: string
  status: string
  reason?: string
  command?: string[]
}

interface ReleaseResult {
  ok: boolean
  dryRun: boolean
  version: string | null
  reason?: string
  failedStep?: string
  steps: ReleaseStep[]
}

function makeExecutor(handler: Handler = () => undefined) {
  const calls: Call[] = []
  const execute = async (command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], cwd: options?.cwd, env: options?.env })
    const override = handler(command, args, options) ?? {}
    return { exitCode: 0, stdout: '', stderr: '', ...override }
  }
  return { calls, execute }
}

function makePackage(version = '1.2.3') {
  const directory = mkdtempSync(join(tmpdir(), 'zzik-release-'))
  const path = join(directory, 'package.json')
  writeFileSync(path, `${JSON.stringify({ name: 'zzik', private: true, version }, null, 2)}\n`)
  return { directory, path }
}

const SCRIPT = fileURLToPath(new URL('../../scripts/release-prep.mjs', import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

describe('Given the release preparation script', () => {
  it('When the patch is computed Then only the patch component advances', () => {
    expect(nextPatchVersion('0.6.24')).toEqual({ ok: true, value: '0.6.25' })
    expect(nextPatchVersion('1.0.0')).toEqual({ ok: true, value: '1.0.1' })
    expect(nextPatchVersion('v1.0.0')).toMatchObject({ ok: false })
    expect(nextPatchVersion('1.0')).toMatchObject({ ok: false })
  })

  it('When dry-run is the default Then prints the plan without any external command or file write', async () => {
    const pkg = makePackage()
    const { calls, execute } = makeExecutor(() => {
      throw new Error('dry-run must not execute commands')
    })
    try {
      const result = (await runReleasePrep({ cwd: pkg.directory, execute })) as ReleaseResult
      expect(result.ok).toBe(true)
      expect(result.dryRun).toBe(true)
      expect(result.version).toBe('1.2.4')
      expect(calls).toHaveLength(0)
      expect(JSON.parse(readFileSync(pkg.path, 'utf8')).version).toBe('1.2.3')
      expect(result.steps.find((step) => step.name === 'version_patch')).toMatchObject({ status: 'PLAN' })
      expect(result.steps.find((step) => step.name === 'test_utc')).toMatchObject({ status: 'PLAN' })
      expect(result.steps.find((step) => step.name === 'ci_wait')).toMatchObject({ status: 'PLAN' })
    } finally {
      rmSync(pkg.directory, { recursive: true, force: true })
    }
  })

  it('When --apply is selected Then bumps the version, runs the ordered gates, commits, pushes and creates the PR', async () => {
    const pkg = makePackage()
    const { calls, execute } = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'dev\n' }
      if (command === 'git' && args[0] === 'status') return { stdout: '' }
      return { stdout: 'ok\n' }
    })
    try {
      const result = (await runReleasePrep({ cwd: pkg.directory, apply: true, execute })) as ReleaseResult
      expect(result.ok).toBe(true)
      expect(result.dryRun).toBe(false)
      expect(result.version).toBe('1.2.4')
      expect(JSON.parse(readFileSync(pkg.path, 'utf8')).version).toBe('1.2.4')
      expect(result.steps.every((step) => step.status === 'PASS')).toBe(true)

      const pnpm = (script: string) => calls.find((call) => call.command === 'pnpm' && call.args[0] === script)
      const kst = calls.filter((call) => call.command === 'pnpm' && call.args[0] === 'test')
      expect(kst).toHaveLength(2)
      expect(kst[0]?.env?.TZ).toBeUndefined()
      expect(kst[1]?.env?.TZ).toBe('UTC')
      expect(pnpm('screenshot:readme')).toBeDefined()
      expect(pnpm('typecheck')).toBeDefined()
      expect(pnpm('typecheck:collector')).toBeDefined()
      expect(pnpm('build')).toBeDefined()

      expect(calls.find((call) => call.command === 'git' && call.args[0] === 'add')?.args).toEqual([
        'add',
        'package.json',
        'docs/screenshots/desktop.png',
      ])
      expect(calls.find((call) => call.command === 'git' && call.args[0] === 'commit')?.args).toEqual(['commit', '-m', 'chore: release 1.2.4'])
      expect(calls.find((call) => call.command === 'git' && call.args[0] === 'push')?.args).toEqual(['push', 'origin', 'dev'])
      expect(calls.find((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create')?.args).toEqual(
        expect.arrayContaining(['-B', 'main', '-H', 'dev']),
      )
      expect(calls.find((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'checks')?.args).toEqual(['pr', 'checks', '--watch'])
    } finally {
      rmSync(pkg.directory, { recursive: true, force: true })
    }
  })

  it('When the branch is not dev or the tree is dirty Then stops before any release command', async () => {
    const notDev = makePackage()
    const notDevExec = makeExecutor((command, args) => (command === 'git' && args[0] === 'rev-parse' ? { stdout: 'main\n' } : undefined))
    try {
      const result = (await runReleasePrep({ cwd: notDev.directory, apply: true, execute: notDevExec.execute })) as ReleaseResult
      expect(result).toMatchObject({ ok: false, reason: 'branch_not_dev', failedStep: 'branch_dev' })
      expect(notDevExec.calls.some((call) => call.command === 'pnpm')).toBe(false)
      expect(JSON.parse(readFileSync(notDev.path, 'utf8')).version).toBe('1.2.3')
    } finally {
      rmSync(notDev.directory, { recursive: true, force: true })
    }

    const dirty = makePackage()
    const dirtyExec = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'dev\n' }
      if (command === 'git' && args[0] === 'status') return { stdout: ' M package.json\n' }
      return undefined
    })
    try {
      const result = (await runReleasePrep({ cwd: dirty.directory, apply: true, execute: dirtyExec.execute })) as ReleaseResult
      expect(result).toMatchObject({ ok: false, reason: 'worktree_dirty', failedStep: 'worktree_clean' })
      expect(dirtyExec.calls.some((call) => call.command === 'pnpm')).toBe(false)
      expect(JSON.parse(readFileSync(dirty.path, 'utf8')).version).toBe('1.2.3')
    } finally {
      rmSync(dirty.directory, { recursive: true, force: true })
    }
  })

  it('When a gate fails Then stops at that step and never commits or pushes', async () => {
    const pkg = makePackage()
    const { calls, execute } = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'dev\n' }
      if (command === 'git' && args[0] === 'status') return { stdout: '' }
      if (command === 'pnpm' && args[0] === 'test') return { exitCode: 1, stdout: '', stderr: 'synthetic failure' }
      return undefined
    })
    try {
      const result = (await runReleasePrep({ cwd: pkg.directory, apply: true, execute })) as ReleaseResult
      expect(result).toMatchObject({ ok: false, reason: 'command_failed', failedStep: 'test_kst' })
      expect(calls.some((call) => call.command === 'git' && call.args[0] === 'commit')).toBe(false)
      expect(calls.some((call) => call.command === 'git' && call.args[0] === 'push')).toBe(false)
      expect(JSON.parse(readFileSync(pkg.path, 'utf8')).version).toBe('1.2.4')
    } finally {
      rmSync(pkg.directory, { recursive: true, force: true })
    }
  })

  it('When command output contains secret-like text Then the JSON result never echoes it', async () => {
    const pkg = makePackage()
    const secret = 'postgresql://user:supersecret@db.example.com/zzik'
    const { execute } = makeExecutor((command, args) => {
      if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'main\n', stderr: secret }
      return { stderr: secret }
    })
    try {
      const result = (await runReleasePrep({ cwd: pkg.directory, apply: true, execute })) as ReleaseResult
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('supersecret')
      expect(serialized).not.toContain('postgresql://')
    } finally {
      rmSync(pkg.directory, { recursive: true, force: true })
    }
  })
})

describe('Given the release preparation CLI branches', () => {
  it('When --help is requested Then prints the apply flag and exits 0', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--apply')
    expect(result.stdout).toContain('--dry-run')
  })

  it('When only --cwd is provided Then defaults to a dry-run and prints the plan', () => {
    const pkg = makePackage()
    try {
      const result = run(['--cwd', pkg.directory])
      expect(result.status).toBe(0)
      const body = JSON.parse(result.stdout) as ReleaseResult
      expect(body.dryRun).toBe(true)
      expect(body.version).toBe('1.2.4')
      expect(body.steps.every((step) => step.status === 'PLAN')).toBe(true)
      expect(JSON.parse(readFileSync(pkg.path, 'utf8')).version).toBe('1.2.3')
    } finally {
      rmSync(pkg.directory, { recursive: true, force: true })
    }
  })

  it('When the flags are invalid or contradictory Then exits 64 without running', () => {
    for (const args of [['--unknown'], ['--apply', '--dry-run']]) {
      const result = run(args)
      expect(result.status).toBe(64)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, reason: 'invalid_arguments' })
    }
  })
})
