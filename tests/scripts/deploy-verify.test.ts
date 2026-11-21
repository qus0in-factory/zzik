import { describe, expect, it } from 'vitest'
import { USAGE_PROVIDERS } from '../../shared/usage-contract'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/deploy-verify.mjs is plain ESM checked by vitest
import { classifyScope, PUBLIC_PATHS, PUBLIC_SPA_PATHS, runDeployVerify, UNAUTH_PATHS, validateShape } from '../../scripts/deploy-verify.mjs'

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

interface Step {
  name: string
  status: string
  reason?: string
  details?: Record<string, unknown>
}

interface DeployResult {
  ok: boolean
  mode: string
  dryRun: boolean
  deployed: boolean
  version: string | null
  scope: Record<string, boolean> | null
  changedFiles: string[]
  steps: Step[]
}

function makeExecutor(handler: Handler) {
  const calls: Call[] = []
  const execute = async (command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], cwd: options?.cwd, env: options?.env })
    const override = handler(command, args, options) ?? {}
    return { exitCode: 0, stdout: '', stderr: '', ...override }
  }
  return { calls, execute }
}

function makeRelease(version = '0.6.25') {
  const directory = mkdtempSync(join(tmpdir(), 'zzik-deploy-'))
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name: 'zzik', version }, null, 2)}\n`)
  writeFileSync(join(directory, '.env'), 'ZZIK_D1_AUTH=wrangler-oauth\n')
  return directory
}

async function verifyWith(handler: Handler): Promise<DeployResult> {
  const release = makeRelease()
  try {
    const { execute } = makeExecutor(handler)
    return (await runDeployVerify({ releaseDir: release, execute })) as DeployResult
  } finally {
    rmSync(release, { recursive: true, force: true })
  }
}

const SCOPE_FILES = 'collector/infra/a.mjs\nworker/index.ts\nwrangler.jsonc\npnpm-lock.yaml\necosystem.config.cjs\n'

function successHandler(overrides: Handler = () => undefined): Handler {
  return (command, args, options) => {
    const custom = overrides(command, args, options)
    if (custom !== undefined) return custom
    if (command === 'git' && args[0] === 'status') return { stdout: '' }
    if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'main\n' }
    if (command === 'git' && args[0] === 'diff') return { stdout: SCOPE_FILES }
    if (command === 'node') return { stdout: 'Tests 3 passed (3)\n' }
    if (command === 'curl') {
      const url = args.at(-1) ?? ''
      if (url.endsWith('/pub/trend')) return { stdout: '{"error":"not_ready","sections":[]}\n503\n' }
      if (url.endsWith('/trend') || /^https?:\/\/[^/]+\/$/.test(url)) return { stdout: '<html><title>Zzik</title></html>\n200\n' }
      if (args.includes('-o')) return { stdout: '302\nhttps://team.cloudflareaccess.com/cdn-cgi/access/login?x\n' }
      return { stdout: '<html>login</html>\n302\n' }
    }
    if (command === 'bash' && args[0] === 'scripts/verify-zzik.sh') return { stdout: 'PASS\n' }
    if (command === 'bash' && args[0] === 'scripts/usage-live-shape.sh') {
      return { stdout: '{"status":"ok","httpStatus":200,"fetchedAt":"2026-11-16T00:00:00.000Z","raw":{"five_hour":1}}\n' }
    }
    if (command === 'pnpm' && args[0] === 'run') return { stdout: 'deployed\n' }
    return undefined
  }
}

const SCRIPT = fileURLToPath(new URL('../../scripts/deploy-verify.mjs', import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

describe('Given the deploy verification script', () => {
  it('When all checks pass without --deploy Then returns step PASS JSON and never deploys', async () => {
    const release = makeRelease()
    const { calls, execute } = makeExecutor(successHandler())
    try {
      const result = (await runDeployVerify({ releaseDir: release, execute })) as DeployResult
      expect(result.ok).toBe(true)
      expect(result.mode).toBe('verify')
      expect(result.deployed).toBe(false)
      expect(result.version).toBe('0.6.25')
      expect(result.scope).toMatchObject({ collector: true, ecosystem: true, wrangler: true, lockfile: true })
      expect(result.changedFiles).toEqual(['collector/infra/a.mjs', 'worker/index.ts', 'wrangler.jsonc', 'pnpm-lock.yaml', 'ecosystem.config.cjs'])
      expect(result.steps.find((step) => step.name === 'deploy')).toMatchObject({ status: 'SKIP', reason: 'flag_not_set' })
      expect(result.steps.find((step) => step.name === 'db_workerd')).toMatchObject({ status: 'PASS' })
      expect(result.steps.find((step) => step.name === 'unauthenticated_302')).toMatchObject({ status: 'PASS' })
      expect(result.steps.find((step) => step.name === 'usage_live_shape')).toMatchObject({ status: 'PASS' })
      expect(calls.some((call) => call.command === 'pnpm' && call.args[0] === 'run')).toBe(false)
      expect(calls.filter((call) => call.command === 'curl')).toHaveLength(UNAUTH_PATHS.length * 2 + PUBLIC_SPA_PATHS.length + PUBLIC_PATHS.length)
      const shapeCalls = calls.filter((call) => call.command === 'bash' && call.args[0] === 'scripts/usage-live-shape.sh')
      expect(shapeCalls.map((call) => call.args[1])).toEqual([...USAGE_PROVIDERS])
      expect(calls.every((call) => call.cwd === undefined || call.cwd === release)).toBe(true)
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When --deploy is selected Then deploys only after the preflight gates pass and then verifies', async () => {
    const release = makeRelease()
    const { calls, execute } = makeExecutor(successHandler())
    try {
      const result = (await runDeployVerify({ releaseDir: release, execute, deploy: true })) as DeployResult
      expect(result.ok).toBe(true)
      expect(result.mode).toBe('deploy')
      expect(result.deployed).toBe(true)
      expect(result.steps.find((step) => step.name === 'deploy')).toMatchObject({ status: 'PASS' })
      expect(calls.find((call) => call.command === 'pnpm' && call.args[0] === 'run')?.args).toEqual(['run', 'deploy'])
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When the release tree is dirty or not main Then fails the gate and skips deploy', async () => {
    const dirty = makeRelease()
    const dirtyExec = makeExecutor(successHandler((command, args) => (command === 'git' && args[0] === 'status' ? { stdout: ' M package.json\n' } : undefined)))
    try {
      const result = (await runDeployVerify({ releaseDir: dirty, execute: dirtyExec.execute, deploy: true })) as DeployResult
      expect(result).toMatchObject({ ok: false, deployed: false })
      expect(result.steps).toEqual([expect.objectContaining({ name: 'release_clean', status: 'FAIL', reason: 'worktree_dirty' })])
      expect(dirtyExec.calls.some((call) => call.command === 'pnpm')).toBe(false)
    } finally {
      rmSync(dirty, { recursive: true, force: true })
    }

    const notMain = makeRelease()
    const notMainExec = makeExecutor(successHandler((command, args) => (command === 'git' && args[0] === 'rev-parse' ? { stdout: 'dev\n' } : undefined)))
    try {
      const result = (await runDeployVerify({ releaseDir: notMain, execute: notMainExec.execute, deploy: true })) as DeployResult
      expect(result).toMatchObject({ ok: false, deployed: false })
      expect(result.steps).toEqual([
        expect.objectContaining({ name: 'release_clean', status: 'PASS' }),
        expect.objectContaining({ name: 'release_version', status: 'FAIL', reason: 'not_main' }),
      ])
      expect(notMainExec.calls.some((call) => call.command === 'pnpm')).toBe(false)
    } finally {
      rmSync(notMain, { recursive: true, force: true })
    }
  })

  it('When db.workerd is skipped or missing .env Then fails the preflight and never deploys', async () => {
    const release = makeRelease()
    const skipped = makeExecutor(successHandler((command) => (command === 'node' ? { stdout: 'Tests 1 skipped (1)\n' } : undefined)))
    try {
      const result = (await runDeployVerify({ releaseDir: release, execute: skipped.execute, deploy: true })) as DeployResult
      expect(result.ok).toBe(false)
      expect(result.steps.find((step) => step.name === 'db_workerd')).toMatchObject({ status: 'FAIL', reason: 'db_workerd_skipped' })
      expect(result.steps.find((step) => step.name === 'deploy')).toMatchObject({ status: 'SKIP', reason: 'preflight_failed' })
      expect(skipped.calls.some((call) => call.command === 'pnpm' && call.args[0] === 'run')).toBe(false)
    } finally {
      rmSync(release, { recursive: true, force: true })
    }


  })

  it('When a 302 path, verify-zzik or live shape fails Then reports the specific step FAIL without raw output', async () => {
    const not302 = await verifyWith(successHandler((command, args) => (command === 'curl' && args.includes('-o') ? { stdout: '200\n' } : undefined)))
    const not302Step = not302.steps.find((entry) => entry.name === 'unauthenticated_302') as Step
    expect(not302Step.status).toBe('FAIL')
    expect((not302Step.details?.paths as Array<{ reason?: string }>)[0]).toMatchObject({ reason: 'not_302' })
    expect(JSON.stringify(not302)).not.toContain('redirect_url')

    const noAccess = await verifyWith(successHandler((command, args) => (command === 'curl' && args.includes('-o') ? { stdout: '302\nhttps://example.com\n' } : undefined)))
    const noAccessStep = noAccess.steps.find((entry) => entry.name === 'unauthenticated_302') as Step
    expect((noAccessStep.details?.paths as Array<{ reason?: string }>)[0]).toMatchObject({ reason: 'missing_access_login' })

    const visible = await verifyWith(successHandler((command, args) => (command === 'curl' && !args.includes('-o') ? { stdout: '<div>Hello Young-In</div>\n302\n' } : undefined)))
    const visibleStep = visible.steps.find((entry) => entry.name === 'unauthenticated_302') as Step
    expect((visibleStep.details?.paths as Array<{ reason?: string }>)[0]).toMatchObject({ reason: 'app_body_visible' })

    const verifyFail = await verifyWith(successHandler((command, args) => (command === 'bash' && args[0] === 'scripts/verify-zzik.sh' ? { exitCode: 1 } : undefined)))
    expect(verifyFail.steps.find((entry) => entry.name === 'verify_zzik')).toMatchObject({ status: 'FAIL', reason: 'verify_failed' })

    const shapeFail = await verifyWith(successHandler((command, args) => (command === 'bash' && args[0] === 'scripts/usage-live-shape.sh' ? { stdout: 'not-json\n' } : undefined)))
    const shapeStep = shapeFail.steps.find((entry) => entry.name === 'usage_live_shape') as Step
    expect(shapeStep.status).toBe('FAIL')
    expect((shapeStep.details?.providers as Array<{ reason?: string }>)[0]).toMatchObject({ reason: 'invalid_shape_json' })
  })

  it('When command stderr contains secrets Then the JSON result never echoes them', async () => {
    const release = makeRelease()
    const secret = 'postgresql://user:supersecret@db.example.com/zzik'
    const { execute } = makeExecutor(successHandler((command) => ({ stderr: secret })))
    try {
      const result = (await runDeployVerify({ releaseDir: release, execute })) as DeployResult
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('supersecret')
      expect(serialized).not.toContain('postgresql://')
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When scope or shape helpers see boundary values Then classify them without printing raw data', () => {
    expect(classifyScope(['collector/a.mjs', 'ecosystem.config.cjs', 'wrangler.jsonc', 'worker/index.ts', 'pnpm-lock.yaml'])).toEqual({
      collector: true,
      ecosystem: true,
      wrangler: true,
      lockfile: true,
    })
    expect(classifyScope(['src/ui/a.tsx'])).toEqual({ collector: false, ecosystem: false, wrangler: false, lockfile: false })
    expect(validateShape('{"status":"ok","httpStatus":200,"fetchedAt":"2026-11-16T00:00:00.000Z","raw":{"a":1}}')).toEqual({
      ok: true,
      value: { status: 'ok', rawKeys: 1 },
    })
    expect(validateShape('{"status":"ok","httpStatus":200,"fetchedAt":null,"raw":[1,2]}')).toEqual({ ok: true, value: { status: 'ok', rawKeys: 2 } })
    expect(validateShape('{"status":"ok","httpStatus":200,"fetchedAt":null,"raw":null}')).toMatchObject({ ok: false, reason: 'raw_missing' })
    expect(validateShape('{"status":"ok","raw":{"a":1}}')).toMatchObject({ ok: false, reason: 'http_status_missing' })
    expect(validateShape('not-json')).toMatchObject({ ok: false, reason: 'invalid_shape_json' })
    expect(validateShape('{"status":null,"httpStatus":null,"fetchedAt":null,"rawOmitted":null,"raw":null}')).toEqual({ ok: true, value: null })
  })
})

describe('Given the deploy verification CLI branches', () => {
  it('When --help is requested Then prints the deploy and dry-run flags and exits 0', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--deploy')
    expect(result.stdout).toContain('--dry-run')
    expect(result.stdout).toContain('--release')
  })

  it('When --dry-run is requested Then prints the plan without running verification', () => {
    const release = makeRelease()
    try {
      const result = run(['--dry-run', '--release', release])
      expect(result.status).toBe(0)
      const body = JSON.parse(result.stdout) as DeployResult
      expect(body.mode).toBe('dry-run')
      expect(body.dryRun).toBe(true)
      expect(body.deployed).toBe(false)
      expect(UNAUTH_PATHS).toContain('/api/usage/zai')
      expect(body.steps.find((step) => step.name === 'usage_live_shape')).toMatchObject({
        status: 'PLAN',
        details: { providers: expect.arrayContaining(['zai']) },
      })
      expect(body.steps.find((step) => step.name === 'release_clean')).toMatchObject({ status: 'PLAN' })
      expect(body.steps.find((step) => step.name === 'deploy')).toMatchObject({ status: 'SKIP', reason: 'flag_not_set' })
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When the flags are invalid or contradictory Then exits 64 without running', () => {
    for (const args of [['--unknown'], ['--deploy', '--dry-run']]) {
      const result = run(args)
      expect(result.status).toBe(64)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, reason: 'invalid_arguments' })
    }
  })
})

describe('Given public path checks after Access change (--check-public default on)', () => {
  it('When checkPublic is omitted Then public_paths runs by default and passes for / 200, /trend 200, /pub/trend 503', async () => {
    const res = await verifyWith(successHandler())
    expect(res.ok).toBe(true)
    expect(res.steps.find((s) => s.name === 'public_paths')).toMatchObject({ status: 'PASS' })
    expect(UNAUTH_PATHS).toContain('/usage')
    expect(UNAUTH_PATHS).not.toContain('/')
  })

  it('When checkPublic is false Then public_paths step is skipped', async () => {
    const release = makeRelease()
    try {
      const { execute } = makeExecutor(successHandler())
      const res = (await runDeployVerify({ releaseDir: release, execute, checkPublic: false })) as DeployResult
      expect(res.ok).toBe(true)
      expect(res.steps.find((s) => s.name === 'public_paths')).toMatchObject({ status: 'SKIP', reason: 'flag_not_set' })
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When /trend leaks usage data or email Then public_paths fails', async () => {
    const release = makeRelease()
    try {
      const { execute } = makeExecutor(successHandler((command, args) => {
        if (command === 'curl' && args.some((a) => a.endsWith('/trend'))) {
          return { stdout: '<html>qus0in@gmail.com usedPercent:80</html>\n200\n' }
        }
        return undefined
      }))
      const res = (await runDeployVerify({ releaseDir: release, execute })) as DeployResult
      expect(res.ok).toBe(false)
      expect(res.steps.find((s) => s.name === 'public_paths')).toMatchObject({ status: 'FAIL', reason: 'public_path_failed' })
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })

  it('When /pub/trend returns 302 Then public_paths fails', async () => {
    const release = makeRelease()
    try {
      const { execute } = makeExecutor(successHandler((command, args) => {
        if (command === 'curl' && args.some((a) => a.endsWith('/pub/trend'))) {
          return { stdout: '\n302\n' }
        }
        return undefined
      }))
      const res = (await runDeployVerify({ releaseDir: release, execute, checkPublic: true })) as DeployResult
      expect(res.ok).toBe(false)
      expect(res.steps.find((s) => s.name === 'public_paths')).toMatchObject({ status: 'FAIL', reason: 'public_path_failed' })
    } finally {
      rmSync(release, { recursive: true, force: true })
    }
  })
})
