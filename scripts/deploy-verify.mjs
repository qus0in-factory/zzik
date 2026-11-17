#!/usr/bin/env node
/**
 * Release deploy verification (issue #100).
 * Default: read-only checks against the current deployment; `pnpm run deploy` only with --deploy.
 * --dry-run prints the plan without running any external command.
 * All external commands use an injectable executor; outputs are classified, never echoed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeCommand } from './lib/exec-command.mjs'

/** @typedef {import('./lib/exec-command.mjs').Executor} Executor */
/** @typedef {'PASS'|'FAIL'|'SKIP'|'PLAN'} StepStatus */
/** @typedef {{name:string,status:StepStatus,reason?:string,details?:Record<string,unknown>}} Step */
/** @typedef {{collector:boolean,ecosystem:boolean,wrangler:boolean,lockfile:boolean}} Scope */

export const UNAUTH_PATHS = Object.freeze([
  '/usage',
  '/api/usage',
  '/api/usage/claude',
  '/api/usage/codex',
  '/api/usage/antigravity',
  '/api/usage/opencode',
  '/api/usage/grok',
  '/api/usage/ollama',
])

export const PUBLIC_SPA_PATHS = Object.freeze(['/', '/trend'])
export const PUBLIC_PATHS = Object.freeze(['/pub/trend'])

export const PROVIDERS = Object.freeze(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])

const APP_BODY_MARKER = 'Hello Young-In'
const DB_WORKERD_TEST = 'tests/worker/read-wiring.workerd.test.ts'

/** @param {string} body */
function hasSensitiveLeak(body) {
  return body.includes(APP_BODY_MARKER) || body.includes('qus0in@gmail.com') || body.includes('usedPercent') || body.includes('"snapshot"')
}

/** @param {readonly string[]} files @returns {Scope} */
export function classifyScope(files) {
  const has = (test) => files.some(test)
  return {
    collector: has((file) => file === 'collector' || file.startsWith('collector/')),
    ecosystem: has((file) => file === 'ecosystem.config.cjs' || file.startsWith('ecosystem/')),
    wrangler: has((file) => file === 'wrangler.jsonc' || file === 'wrangler.toml' || file.startsWith('worker/')),
    lockfile: files.includes('pnpm-lock.yaml'),
  }
}

/** @param {Scope} scope @returns {string[]} */
export function scopeNotes(scope) {
  const notes = []
  if (scope.collector) notes.push('collector_changed_restart_after_release')
  if (scope.ecosystem) notes.push('ecosystem_changed_pm2_reload')
  if (scope.wrangler) notes.push('wrangler_or_worker_changed_deploy_required')
  if (scope.lockfile) notes.push('lockfile_changed_frozen_install_required')
  return notes
}

/** @param {string} stdout @returns {{ok:true,value:{httpStatus:number,location:string,body:string}}|{ok:false,reason:'request_failed'}} */
function parseCurl(stdout) {
  const trimmed = stdout.trimEnd()
  if (trimmed === '') return { ok: false, reason: 'request_failed' }
  const lines = trimmed.split(/\r?\n/)
  const httpStatus = Number(lines[0])
  if (!Number.isSafeInteger(httpStatus)) return { ok: false, reason: 'request_failed' }
  return { ok: true, value: { httpStatus, location: lines[1] ?? '', body: '' } }
}

/** @param {string} stdout @returns {{ok:true,value:{httpStatus:number,body:string}}|{ok:false,reason:'request_failed'}} */
function parseCurlBody(stdout) {
  const trimmed = stdout.trimEnd()
  const cut = trimmed.lastIndexOf('\n')
  const statusText = cut < 0 ? trimmed : trimmed.slice(cut + 1)
  const httpStatus = Number(statusText)
  if (!Number.isSafeInteger(httpStatus)) return { ok: false, reason: 'request_failed' }
  return { ok: true, value: { httpStatus, body: cut < 0 ? '' : trimmed.slice(0, cut) } }
}

/** @param {string} text @returns {{ok:true,value:{status:string,rawKeys:number}}|{ok:false,reason:'invalid_shape_json'|'raw_missing'|'status_missing'|'http_status_missing'|'fetched_at_missing'}} */
export function validateShape(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'invalid_shape_json' }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'invalid_shape_json' }
  const record = /** @type {Record<string, unknown>} */ (parsed)
  if (typeof record.status !== 'string') return { ok: false, reason: 'status_missing' }
  if (!(record.httpStatus === null || typeof record.httpStatus === 'number')) return { ok: false, reason: 'http_status_missing' }
  if (!(record.fetchedAt === null || typeof record.fetchedAt === 'string')) return { ok: false, reason: 'fetched_at_missing' }
  if (record.raw === null || typeof record.raw !== 'object') return { ok: false, reason: 'raw_missing' }
  const rawKeys = Array.isArray(record.raw) ? record.raw.length : Object.keys(record.raw).length
  return { ok: true, value: { status: record.status, rawKeys } }
}

/** @param {string} cwd @returns {{ok:true,value:string}|{ok:false,reason:'package_json_unavailable'|'invalid_version'}} */
function readVersion(cwd) {
  try {
    const parsed = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(parsed.version)) {
      return { ok: false, reason: 'invalid_version' }
    }
    return { ok: true, value: parsed.version }
  } catch {
    return { ok: false, reason: 'package_json_unavailable' }
  }
}

/** @param {string} stdout @returns {{ok:true}|{ok:false,reason:'db_workerd_failed'|'db_workerd_skipped'|'db_workerd_no_result'}} */
export function classifyVitest(stdout) {
  if (/\bskipped\b/i.test(stdout) || /\b0 passed\b/i.test(stdout)) return { ok: false, reason: 'db_workerd_skipped' }
  if (/\b\d+ passed\b/i.test(stdout)) return { ok: true }
  return { ok: false, reason: 'db_workerd_no_result' }
}

/**
 * @param {{releaseDir?:string,execute?:Executor,deploy?:boolean,dryRun?:boolean,checkPublic?:boolean,origin?:string,workersSubdomain?:string,base?:string}} [options]
 * @returns {Promise<{ok:boolean,mode:'dry-run'|'verify'|'deploy',dryRun:boolean,deployRequested:boolean,deployed:boolean,releaseDir:string,version:string|null,scope:Scope|null,changedFiles:string[],steps:Step[]}>}
 */
export async function runDeployVerify(options = {}) {
  const releaseDir = resolve(options.releaseDir ?? resolve(process.cwd(), '.worktree/release'))
  const execute = options.execute ?? executeCommand
  const deployRequested = options.deploy === true
  const dryRun = options.dryRun === true
  const checkPublic = options.checkPublic !== false
  const origin = (options.origin ?? 'https://zzik.qus0in.dev').replace(/\/+$/, '')
  const workersSubdomain = options.workersSubdomain ?? 'qus0in'
  const base = options.base ?? 'HEAD^'
  const mode = dryRun ? 'dry-run' : deployRequested ? 'deploy' : 'verify'
  /** @type {Step[]} */
  const steps = []
  /** @type {Scope|null} */
  let scope = null
  /** @type {string[]} */
  let changedFiles = []

  const empty = (reason) => ({
    ok: false,
    mode,
    dryRun,
    deployRequested,
    deployed: false,
    releaseDir,
    version: null,
    scope,
    changedFiles,
    steps: [...steps, { name: 'release_dir', status: 'FAIL', reason }],
  })

  if (!existsSync(releaseDir) || !existsSync(resolve(releaseDir, 'package.json'))) return empty('release_missing')
  const version = readVersion(releaseDir)
  if (!version.ok) return empty(version.reason)

  if (dryRun) {
    if (deployRequested) {
      steps.push({ name: 'deploy', status: 'PLAN', reason: 'deploy_in_dry_run' })
    } else {
      steps.push({ name: 'deploy', status: 'SKIP', reason: 'flag_not_set' })
    }
    steps.unshift(
      { name: 'release_clean', status: 'PLAN' },
      { name: 'release_version', status: 'PLAN' },
      { name: 'change_scope', status: 'PLAN' },
      { name: 'db_workerd', status: 'PLAN' },
      { name: 'unauthenticated_302', status: 'PLAN', details: { paths: [...UNAUTH_PATHS] } },
      { name: 'public_paths', status: checkPublic ? 'PLAN' : 'SKIP', ...(checkPublic ? { details: { spaPaths: [...PUBLIC_SPA_PATHS], paths: [...PUBLIC_PATHS] } } : { reason: 'flag_not_set' }) },
      { name: 'verify_zzik', status: 'PLAN' },
      { name: 'usage_live_shape', status: 'PLAN', details: { providers: [...PROVIDERS] } },
    )
    return { ok: true, mode, dryRun, deployRequested, deployed: false, releaseDir, version: version.value, scope, changedFiles, steps }
  }

  const clean = await execute('git', ['status', '--porcelain'], { cwd: releaseDir, timeoutMs: 120_000 })
  const cleanOk = clean.exitCode === 0 && clean.stdout.trim() === ''
  steps.push({ name: 'release_clean', status: cleanOk ? 'PASS' : 'FAIL', ...(cleanOk ? {} : { reason: clean.exitCode === 0 ? 'worktree_dirty' : 'git_status_failed' }) })
  if (!cleanOk) return { ok: false, mode, dryRun, deployRequested, deployed: false, releaseDir, version: version.value, scope, changedFiles, steps }

  const branch = await execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: releaseDir, timeoutMs: 120_000 })
  const main = branch.exitCode === 0 && branch.stdout.trim() === 'main'
  steps.push({ name: 'release_version', status: main ? 'PASS' : 'FAIL', ...(main ? {} : { reason: branch.exitCode === 0 ? 'not_main' : 'git_status_failed' }) })
  if (!main) return { ok: false, mode, dryRun, deployRequested, deployed: false, releaseDir, version: version.value, scope, changedFiles, steps }

  const diff = await execute('git', ['diff', '--name-only', base, 'HEAD'], { cwd: releaseDir, timeoutMs: 120_000 })
  if (diff.exitCode === 0) {
    changedFiles = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
    scope = classifyScope(changedFiles)
    steps.push({ name: 'change_scope', status: 'PASS', details: { scope, changedFiles, notes: scopeNotes(scope) } })
  } else {
    steps.push({ name: 'change_scope', status: 'FAIL', reason: 'scope_unavailable' })
  }

  let preflightOk = true
  const db = await execute('node', ['node_modules/vitest/vitest.mjs', 'run', DB_WORKERD_TEST], { cwd: releaseDir, timeoutMs: 900_000 })
  if (db.exitCode !== 0) {
    preflightOk = false
    steps.push({ name: 'db_workerd', status: 'FAIL', reason: 'db_workerd_failed' })
  } else {
    const classified = classifyVitest(db.stdout)
    if (!classified.ok) {
      preflightOk = false
      steps.push({ name: 'db_workerd', status: 'FAIL', reason: classified.reason })
    } else {
      steps.push({ name: 'db_workerd', status: 'PASS' })
    }
  }
  let deployed = false
  if (!deployRequested) {
    steps.push({ name: 'deploy', status: 'SKIP', reason: 'flag_not_set' })
  } else if (!preflightOk) {
    steps.push({ name: 'deploy', status: 'SKIP', reason: 'preflight_failed' })
  } else {
    const result = await execute('pnpm', ['run', 'deploy'], { cwd: releaseDir, timeoutMs: 1_800_000 })
    deployed = result.exitCode === 0
    steps.push(deployed ? { name: 'deploy', status: 'PASS' } : { name: 'deploy', status: 'FAIL', reason: 'deploy_failed' })
  }

  const pathResults = []
  for (const path of UNAUTH_PATHS) {
    const url = `${origin}${path}`
    const header = await execute('curl', ['-sS', '--max-time', '30', '-o', '/dev/null', '-w', '%{http_code}\n%{redirect_url}\n', url], { timeoutMs: 60_000 })
    if (header.exitCode !== 0) {
      pathResults.push({ path, status: 'FAIL', reason: 'request_failed' })
      continue
    }
    const head = parseCurl(header.stdout)
    if (!head.ok) {
      pathResults.push({ path, status: 'FAIL', reason: head.reason })
      continue
    }
    if (head.value.httpStatus !== 302) {
      pathResults.push({ path, status: 'FAIL', httpStatus: head.value.httpStatus, reason: 'not_302' })
      continue
    }
    if (!head.value.location.includes('cdn-cgi/access/login')) {
      pathResults.push({ path, status: 'FAIL', httpStatus: head.value.httpStatus, reason: 'missing_access_login' })
      continue
    }
    const body = await execute('curl', ['-sS', '--max-time', '30', '-w', '\n%{http_code}\n', url], { timeoutMs: 60_000 })
    if (body.exitCode !== 0) {
      pathResults.push({ path, status: 'FAIL', httpStatus: head.value.httpStatus, reason: 'request_failed' })
      continue
    }
    const parsedBody = parseCurlBody(body.stdout)
    if (!parsedBody.ok) {
      pathResults.push({ path, status: 'FAIL', reason: parsedBody.reason })
      continue
    }
    if (parsedBody.value.httpStatus !== 302) {
      pathResults.push({ path, status: 'FAIL', httpStatus: parsedBody.value.httpStatus, reason: 'not_302' })
      continue
    }
    if (parsedBody.value.body.includes(APP_BODY_MARKER)) {
      pathResults.push({ path, status: 'FAIL', httpStatus: parsedBody.value.httpStatus, reason: 'app_body_visible' })
      continue
    }
    pathResults.push({ path, status: 'PASS', httpStatus: parsedBody.value.httpStatus })
  }
  const pathsOk = pathResults.every((result) => result.status === 'PASS')
  steps.push({
    name: 'unauthenticated_302',
    status: pathsOk ? 'PASS' : 'FAIL',
    ...(pathsOk ? {} : { reason: 'unauthenticated_path_failed' }),
    details: { paths: pathResults },
  })

  if (!checkPublic) {
    steps.push({ name: 'public_paths', status: 'SKIP', reason: 'flag_not_set' })
  } else {
    const publicResults = []
    for (const path of PUBLIC_SPA_PATHS) {
      const url = `${origin}${path}`
      const res = await execute('curl', ['-sS', '--max-time', '30', '-w', '\n%{http_code}\n', url], { timeoutMs: 60_000 })
      if (res.exitCode !== 0) {
        publicResults.push({ path, status: 'FAIL', reason: 'request_failed' })
        continue
      }
      const parsedBody = parseCurlBody(res.stdout)
      if (!parsedBody.ok) {
        publicResults.push({ path, status: 'FAIL', reason: parsedBody.reason })
        continue
      }
      const code = parsedBody.value.httpStatus
      if (code !== 200) {
        publicResults.push({ path, status: 'FAIL', httpStatus: code, reason: code === 302 ? 'unexpected_302' : 'unexpected_status' })
        continue
      }
      if (hasSensitiveLeak(parsedBody.value.body)) {
        publicResults.push({ path, status: 'FAIL', httpStatus: code, reason: 'sensitive_body_visible' })
        continue
      }
      publicResults.push({ path, status: 'PASS', httpStatus: code })
    }
    for (const path of PUBLIC_PATHS) {
      const url = `${origin}${path}`
      const res = await execute('curl', ['-sS', '--max-time', '30', '-w', '\n%{http_code}\n', url], { timeoutMs: 60_000 })
      if (res.exitCode !== 0) {
        publicResults.push({ path, status: 'FAIL', reason: 'request_failed' })
        continue
      }
      const parsedBody = parseCurlBody(res.stdout)
      if (!parsedBody.ok) {
        publicResults.push({ path, status: 'FAIL', reason: parsedBody.reason })
        continue
      }
      const code = parsedBody.value.httpStatus
      if (code !== 200 && code !== 503) {
        publicResults.push({ path, status: 'FAIL', httpStatus: code, reason: code === 302 ? 'unexpected_302' : 'unexpected_status' })
        continue
      }
      if (hasSensitiveLeak(parsedBody.value.body)) {
        publicResults.push({ path, status: 'FAIL', httpStatus: code, reason: 'app_body_visible' })
        continue
      }
      publicResults.push({ path, status: 'PASS', httpStatus: code })
    }
    const publicOk = publicResults.every((result) => result.status === 'PASS')
    steps.push({
      name: 'public_paths',
      status: publicOk ? 'PASS' : 'FAIL',
      ...(publicOk ? {} : { reason: 'public_path_failed' }),
      details: { paths: publicResults },
    })
  }

  const verify = await execute('bash', ['scripts/verify-zzik.sh', workersSubdomain], { cwd: releaseDir, timeoutMs: 300_000 })
  steps.push(verify.exitCode === 0 ? { name: 'verify_zzik', status: 'PASS' } : { name: 'verify_zzik', status: 'FAIL', reason: 'verify_failed' })

  const shapeResults = []
  for (const provider of PROVIDERS) {
    const shape = await execute('bash', ['scripts/usage-live-shape.sh', provider], { cwd: releaseDir, timeoutMs: 300_000 })
    if (shape.exitCode !== 0) {
      shapeResults.push({ provider, status: 'FAIL', reason: 'shape_command_failed' })
      continue
    }
    const validated = validateShape(shape.stdout)
    shapeResults.push(validated.ok ? { provider, status: 'PASS' } : { provider, status: 'FAIL', reason: validated.reason })
  }
  const shapesOk = shapeResults.every((result) => result.status === 'PASS')
  steps.push({
    name: 'usage_live_shape',
    status: shapesOk ? 'PASS' : 'FAIL',
    ...(shapesOk ? {} : { reason: 'usage_shape_mismatch' }),
    details: { providers: shapeResults },
  })

  return {
    ok: steps.every((step) => step.status !== 'FAIL'),
    mode,
    dryRun,
    deployRequested,
    deployed,
    releaseDir,
    version: version.value,
    scope,
    changedFiles,
    steps,
  }
}

function usage() {
  process.stdout.write(
    'node scripts/deploy-verify.mjs [--dry-run] [--deploy] [--check-public] [--release <dir>] [--origin <url>] [--workers-subdomain <sub>] [--base <rev>]\n' +
      'Default: read-only release/clean/version/scope, D1 workerd, cookie-less 302 paths, verify-zzik and usage-live-shape checks. No deploy.\n' +
      '--deploy: run pnpm run deploy only after the preflight checks pass. --dry-run: print the plan and run nothing.\n' +
      'Output is step-level PASS/FAIL JSON; command output, Location headers and credentials are never printed.\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  let deploy = false
  let dryRun = false
  let checkPublic = true
  let releaseDir = resolve(process.cwd(), '.worktree/release')
  let origin = 'https://zzik.qus0in.dev'
  let workersSubdomain = 'qus0in'
  let base = 'HEAD^'
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--deploy') deploy = true
    else if (args[i] === '--dry-run') dryRun = true
    else if (args[i] === '--check-public') checkPublic = true
    else if (args[i] === '--no-check-public') checkPublic = false
    else if (args[i] === '--release' && args[i + 1] && !args[i + 1].startsWith('--')) releaseDir = resolve(args[++i])
    else if (args[i] === '--origin' && args[i + 1] && !args[i + 1].startsWith('--')) origin = args[++i]
    else if (args[i] === '--workers-subdomain' && args[i + 1] && !args[i + 1].startsWith('--')) workersSubdomain = args[++i]
    else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('--')) base = args[++i]
    else {
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid_arguments', steps: [] })}\n`)
      process.exitCode = 64
      return
    }
  }
  if (deploy && dryRun) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid_arguments', steps: [] })}\n`)
    process.exitCode = 64
    return
  }
  const result = await runDeployVerify({ releaseDir, deploy, dryRun, checkPublic, origin, workersSubdomain, base })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'deploy_verify_failed', steps: [] })}\n`)
    process.exitCode = 1
  }
}
