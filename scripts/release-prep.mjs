#!/usr/bin/env node
/**
 * Release preparation for the dev -> main PR flow (issue #100).
 * Defaults to a no-write dry-run. --apply performs the release.
 * Every external command goes through an injectable executor so tests can use fakes.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeCommand } from './lib/exec-command.mjs'

/** @typedef {import('./lib/exec-command.mjs').Executor} Executor */
/** @typedef {{name:string,command:readonly string[],env?:Record<string,string>,timeoutMs?:number}} PlannedStep */
/** @typedef {{name:string,status:'PLAN'|'PASS'|'FAIL',command?:readonly string[],env?:Record<string,string>,reason?:string,details?:Record<string,unknown>}} ReportedStep */

/** @param {string} version @returns {{ok:true,value:string}|{ok:false,reason:'invalid_version'}} */
export function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (match === null) return { ok: false, reason: 'invalid_version' }
  const patch = Number(match[3])
  if (!Number.isSafeInteger(patch)) return { ok: false, reason: 'invalid_version' }
  return { ok: true, value: `${match[1]}.${match[2]}.${patch + 1}` }
}

/** @param {string} version @returns {PlannedStep[]} */
export function releasePlan(version) {
  const message = `chore: release ${version}`
  return [
    { name: 'screenshot_readme', command: ['pnpm', 'screenshot:readme'], timeoutMs: 300_000 },
    { name: 'test_kst', command: ['pnpm', 'test'], env: { TZ: 'Asia/Seoul' }, timeoutMs: 900_000 },
    { name: 'check_hangul_spacing', command: ['node', 'scripts/check-hangul-spacing.mjs', '--base', 'origin/main'], timeoutMs: 120_000 },
    { name: 'stage', command: ['git', 'add', 'package.json', 'docs/screenshots/desktop.png'], timeoutMs: 120_000 },
    { name: 'commit', command: ['git', 'commit', '-m', message], timeoutMs: 120_000 },
    { name: 'push_dev', command: ['git', 'push', 'origin', 'dev'], timeoutMs: 300_000 },
    { name: 'pull_request_check', command: ['gh', 'pr', 'list', '--head', 'dev', '--base', 'main', '--state', 'open', '--limit', '1', '--json', 'number'], timeoutMs: 120_000 },
    {
      name: 'pull_request',
      command: ['gh', 'pr', 'create', '-B', 'main', '-H', 'dev', '--title', message, '--body', `Release ${version}`],
      timeoutMs: 120_000,
    },
    { name: 'ci_wait', command: ['gh', 'pr', 'checks', '--watch'], timeoutMs: 1_800_000 },
  ]
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {string} cwd @returns {{ok:true,value:{path:string,json:Record<string,unknown>}}|{ok:false,reason:'package_json_unavailable'}} */
function readPackage(cwd) {
  const path = resolve(cwd, 'package.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed) || typeof parsed.version !== 'string') return { ok: false, reason: 'package_json_unavailable' }
    return { ok: true, value: { path, json: parsed } }
  } catch {
    return { ok: false, reason: 'package_json_unavailable' }
  }
}

/**
 * @param {{cwd?:string,apply?:boolean,execute?:Executor}} [options]
 * @returns {Promise<{ok:boolean,dryRun:boolean,version:string|null,reason?:string,failedStep?:string,steps:ReportedStep[]}>}
 */
export async function runReleasePrep(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const apply = options.apply === true
  const execute = options.execute ?? executeCommand
  const dryRun = !apply
  const pkg = readPackage(cwd)
  if (!pkg.ok) return { ok: false, dryRun, version: null, reason: pkg.reason, steps: [] }
  const next = nextPatchVersion(pkg.value.json.version)
  if (!next.ok) return { ok: false, dryRun, version: null, reason: next.reason, steps: [] }

  /** @type {ReportedStep[]} */
  const steps = []
  if (dryRun) {
    steps.push({ name: 'branch_dev', status: 'PLAN', command: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] })
    steps.push({ name: 'worktree_clean', status: 'PLAN', command: ['git', 'status', '--porcelain'] })
    steps.push({ name: 'version_patch', status: 'PLAN' })
    for (const step of releasePlan(next.value)) steps.push({ name: step.name, status: 'PLAN', command: step.command, ...(step.env === undefined ? {} : { env: step.env }) })
    return { ok: true, dryRun, version: next.value, steps }
  }

  const branch = await execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 120_000 })
  const branchOk = branch.exitCode === 0 && branch.stdout.trim() === 'dev'
  steps.push({ name: 'branch_dev', status: branchOk ? 'PASS' : 'FAIL', command: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], ...(branchOk ? {} : { reason: 'branch_not_dev' }) })
  if (!branchOk) return { ok: false, dryRun, version: next.value, reason: 'branch_not_dev', failedStep: 'branch_dev', steps }

  const status = await execute('git', ['status', '--porcelain'], { cwd, timeoutMs: 120_000 })
  const clean = status.exitCode === 0 && status.stdout.trim() === ''
  steps.push({ name: 'worktree_clean', status: clean ? 'PASS' : 'FAIL', command: ['git', 'status', '--porcelain'], ...(clean ? {} : { reason: status.exitCode === 0 ? 'worktree_dirty' : 'git_status_failed' }) })
  if (!clean) return { ok: false, dryRun, version: next.value, reason: status.exitCode === 0 ? 'worktree_dirty' : 'git_status_failed', failedStep: 'worktree_clean', steps }

  try {
    writeFileSync(pkg.value.path, `${JSON.stringify({ ...pkg.value.json, version: next.value }, null, 2)}\n`)
  } catch {
    steps.push({ name: 'version_patch', status: 'FAIL', reason: 'package_json_write_failed' })
    return { ok: false, dryRun, version: next.value, reason: 'package_json_write_failed', failedStep: 'version_patch', steps }
  }
  steps.push({ name: 'version_patch', status: 'PASS' })

  let skipPullRequest = false
  for (const step of releasePlan(next.value)) {
    if (step.name === 'pull_request' && skipPullRequest) {
      steps.push({ name: step.name, status: 'PASS', reason: 'existing_pr_reused', ...(step.env === undefined ? {} : { env: step.env }) })
      continue
    }
    const result = await execute(step.command[0], step.command.slice(1), {
      cwd,
      ...(step.env === undefined ? {} : { env: step.env }),
      ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    })
    if (result.exitCode !== 0) {
      steps.push({ name: step.name, status: 'FAIL', command: step.command, ...(step.env === undefined ? {} : { env: step.env }), reason: 'command_failed' })
      return { ok: false, dryRun, version: next.value, reason: 'command_failed', failedStep: step.name, steps }
    }
    if (step.name === 'pull_request_check') {
      let prs
      try {
        prs = JSON.parse(result.stdout)
      } catch {
        steps.push({ name: step.name, status: 'FAIL', command: step.command, reason: 'command_failed' })
        return { ok: false, dryRun, version: next.value, reason: 'command_failed', failedStep: step.name, steps }
      }
      if (!Array.isArray(prs)) {
        steps.push({ name: step.name, status: 'FAIL', command: step.command, reason: 'command_failed' })
        return { ok: false, dryRun, version: next.value, reason: 'command_failed', failedStep: step.name, steps }
      }
      const first = prs[0]
      const number = first !== null && typeof first === 'object' && Number.isSafeInteger(/** @type {{number?:unknown}} */(first).number) ? /** @type {{number:number}} */(first).number : null
      skipPullRequest = prs.length > 0
      if (skipPullRequest && number === null) {
        steps.push({ name: step.name, status: 'FAIL', command: step.command, reason: 'command_failed' })
        return { ok: false, dryRun, version: next.value, reason: 'command_failed', failedStep: step.name, steps }
      }
      steps.push({ name: step.name, status: 'PASS', command: step.command, details: skipPullRequest ? { existing: true, number } : { existing: false } })
      continue
    }
    steps.push({ name: step.name, status: 'PASS', command: step.command, ...(step.env === undefined ? {} : { env: step.env }) })
  }

  return { ok: true, dryRun, version: next.value, steps }
}

function usage() {
  process.stdout.write(
    'node scripts/release-prep.mjs [--dry-run|--apply] [--cwd <directory>]\n' +
      'Default: dry-run. Prints the version bump, screenshot/KST test/spacing check, commit, dev push, dev->main PR reuse/create and CI wait without running them.\n' +
      '--apply: runs the same local steps in order and stops on the first failure; CI remains the UTC test/typecheck/build gate. Never prints command output or credentials.\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  let apply = false
  let applySeen = false
  let drySeen = false
  let cwd = process.cwd()
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') {
      apply = true
      applySeen = true
    } else if (args[i] === '--dry-run') {
      drySeen = true
    } else if (args[i] === '--cwd' && args[i + 1] && !args[i + 1].startsWith('--')) {
      cwd = resolve(args[++i])
    } else {
      process.stdout.write(`${JSON.stringify({ ok: false, dryRun: true, reason: 'invalid_arguments', steps: [] })}\n`)
      process.exitCode = 64
      return
    }
  }
  if (applySeen && drySeen) {
    process.stdout.write(`${JSON.stringify({ ok: false, dryRun: true, reason: 'invalid_arguments', steps: [] })}\n`)
    process.exitCode = 64
    return
  }
  const result = await runReleasePrep({ cwd, apply })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) {
    process.exitCode = result.reason === 'package_json_unavailable' || result.reason === 'invalid_version' || result.reason === 'branch_not_dev' || result.reason === 'worktree_dirty' ? 78 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, dryRun: true, reason: 'release_prep_failed', steps: [] })}\n`)
    process.exitCode = 1
  }
}
