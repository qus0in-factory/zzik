#!/usr/bin/env node
/**
 * Create, merge, and remove a dev worktree track (issue #100).
 * Default is a no-write dry-run. --apply runs git. External commands are injectable.
 * Command stdout is classified and never printed.
 */
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeCommand } from './lib/exec-command.mjs'

/** @typedef {import('./lib/exec-command.mjs').Executor} Executor */
/** @typedef {{name:string,status:'PLAN'|'PASS'|'FAIL',command?:readonly string[],reason?:string}} ReportedStep */

const TRACK = /^[a-z][a-z0-9-]{0,40}$/
const VERSION = /^\d+\.\d+(?:\.\d+)?$/

/**
 * @param {string} cwd
 * @param {string} track
 * @returns {string|null}
 */
export function trackWorktreePath(cwd, track) {
  if (!TRACK.test(track)) return null
  const root = resolve(cwd)
  const parent = resolve(root, '.worktree')
  const path = resolve(parent, track)
  if (path !== `${parent}${sep}${track}`) return null
  return path
}

/**
 * @param {string} porcelain
 * @param {string} worktreePath
 * @param {string} track
 * @returns {{ok:true,branch:string}|{ok:false,reason:'worktree_missing'|'worktree_detached'|'worktree_ambiguous'|'branch_not_track'}}
 */
export function resolveWorktreeBranch(porcelain, worktreePath, track) {
  const wanted = resolve(worktreePath)
  /** @type {{path:string,branch:string|null,detached:boolean}|null} */
  let current = null
  /** @type {{path:string,branch:string|null,detached:boolean}|null} */
  let found = null
  let ambiguous = false
  const flush = () => {
    if (current === null || resolve(current.path) !== wanted) return
    if (found !== null) ambiguous = true
    found = current
  }
  for (const line of porcelain.split('\n')) {
    if (line === '') {
      flush()
      current = null
      continue
    }
    if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length), branch: null, detached: false }
    else if (current !== null && line.startsWith('branch ')) current.branch = line.slice('branch '.length)
    else if (current !== null && line === 'detached') current.detached = true
  }
  flush()
  if (ambiguous) return { ok: false, reason: 'worktree_ambiguous' }
  if (found === null) return { ok: false, reason: 'worktree_missing' }
  if (found.detached || found.branch === null || !found.branch.startsWith('refs/heads/')) return { ok: false, reason: 'worktree_detached' }
  const branch = found.branch.slice('refs/heads/'.length)
  if (!new RegExp(`^\\d+\\.\\d+(?:\\.\\d+)?/${track}$`).test(branch)) return { ok: false, reason: 'branch_not_track' }
  return { ok: true, branch }
}

/**
 * @param {{action?:string,track?:string,version?:string,message?:string,apply?:boolean,cwd?:string,execute?:Executor}} [options]
 */
export async function runWorktreeTrack(options = {}) {
  const action = options.action
  const track = options.track ?? ''
  const cwd = resolve(options.cwd ?? process.cwd())
  const apply = options.apply === true
  const execute = options.execute ?? executeCommand
  const dryRun = !apply
  const path = trackWorktreePath(cwd, track)
  if (path === null) return { ok: false, dryRun, action, track, reason: 'invalid_track', steps: [] }

  if (action === 'create') {
    const version = options.version ?? ''
    if (!VERSION.test(version)) return { ok: false, dryRun, action, track, version, reason: 'invalid_version', steps: [] }
    const command = ['git', 'worktree', 'add', path, '-b', `${version}/${track}`, 'dev']
    if (dryRun) return { ok: true, dryRun, action, track, version, steps: [{ name: 'worktree_add', status: 'PLAN', command }] }
    const result = await execute('git', command.slice(1), { cwd, timeoutMs: 120_000 })
    const step = { name: 'worktree_add', status: result.exitCode === 0 ? 'PASS' : 'FAIL', command, ...(result.exitCode === 0 ? {} : { reason: 'command_failed' }) }
    return result.exitCode === 0
      ? { ok: true, dryRun, action, track, version, steps: [step] }
      : { ok: false, dryRun, action, track, version, reason: 'command_failed', failedStep: 'worktree_add', steps: [step] }
  }

  if (action === 'remove') {
    const command = ['git', 'worktree', 'remove', path]
    if (dryRun) return { ok: true, dryRun, action, track, steps: [{ name: 'worktree_remove', status: 'PLAN', command }] }
    const result = await execute('git', command.slice(1), { cwd, timeoutMs: 120_000 })
    const step = { name: 'worktree_remove', status: result.exitCode === 0 ? 'PASS' : 'FAIL', command, ...(result.exitCode === 0 ? {} : { reason: 'command_failed' }) }
    return result.exitCode === 0
      ? { ok: true, dryRun, action, track, steps: [step] }
      : { ok: false, dryRun, action, track, reason: 'command_failed', failedStep: 'worktree_remove', steps: [step] }
  }

  if (action === 'merge') {
    const message = options.message ?? ''
    if (message.trim() === '') return { ok: false, dryRun, action, track, reason: 'message_required', steps: [] }
    /** @type {ReportedStep[]} */
    const planned = [
      { name: 'branch_dev', status: 'PLAN', command: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] },
      { name: 'worktree_clean', status: 'PLAN', command: ['git', 'status', '--porcelain'] },
      { name: 'resolve_branch', status: 'PLAN', command: ['git', 'worktree', 'list', '--porcelain'] },
      { name: 'merge', status: 'PLAN', command: ['git', 'merge', '--no-ff', '-m', message] },
    ]
    if (dryRun) return { ok: true, dryRun, action, track, steps: planned }

    /** @type {ReportedStep[]} */
    const steps = []
    const branch = await execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 120_000 })
    const onDev = branch.exitCode === 0 && branch.stdout.trim() === 'dev'
    steps.push({ name: 'branch_dev', status: onDev ? 'PASS' : 'FAIL', command: planned[0].command, ...(onDev ? {} : { reason: 'branch_not_dev' }) })
    if (!onDev) return { ok: false, dryRun, action, track, reason: 'branch_not_dev', failedStep: 'branch_dev', steps }

    const status = await execute('git', ['status', '--porcelain'], { cwd, timeoutMs: 120_000 })
    const clean = status.exitCode === 0 && status.stdout.trim() === ''
    steps.push({
      name: 'worktree_clean',
      status: clean ? 'PASS' : 'FAIL',
      command: planned[1].command,
      ...(clean ? {} : { reason: status.exitCode === 0 ? 'worktree_dirty' : 'git_status_failed' }),
    })
    if (!clean) {
      return {
        ok: false,
        dryRun,
        action,
        track,
        reason: status.exitCode === 0 ? 'worktree_dirty' : 'git_status_failed',
        failedStep: 'worktree_clean',
        steps,
      }
    }

    const listed = await execute('git', ['worktree', 'list', '--porcelain'], { cwd, timeoutMs: 120_000 })
    const resolved = listed.exitCode === 0 ? resolveWorktreeBranch(listed.stdout, path, track) : { ok: false, reason: 'worktree_missing' }
    steps.push({
      name: 'resolve_branch',
      status: resolved.ok ? 'PASS' : 'FAIL',
      command: planned[2].command,
      ...(resolved.ok ? {} : { reason: resolved.reason }),
    })
    if (!resolved.ok) return { ok: false, dryRun, action, track, reason: resolved.reason, failedStep: 'resolve_branch', steps }

    const mergeCommand = ['git', 'merge', '--no-ff', '-m', message, resolved.branch]
    const merged = await execute('git', mergeCommand.slice(1), { cwd, timeoutMs: 120_000 })
    steps.push({
      name: 'merge',
      status: merged.exitCode === 0 ? 'PASS' : 'FAIL',
      command: mergeCommand,
      ...(merged.exitCode === 0 ? {} : { reason: 'command_failed' }),
    })
    if (merged.exitCode !== 0) return { ok: false, dryRun, action, track, branch: resolved.branch, reason: 'command_failed', failedStep: 'merge', steps }
    return { ok: true, dryRun, action, track, branch: resolved.branch, steps }
  }

  return { ok: false, dryRun, action, track, reason: 'invalid_arguments', steps: [] }
}

function usage() {
  process.stdout.write(
    'node scripts/worktree-track.mjs create <track> <version> [--apply] [--cwd <dir>]\n' +
      'node scripts/worktree-track.mjs merge <track> --message <text> [--apply] [--cwd <dir>]\n' +
      'node scripts/worktree-track.mjs remove <track> [--apply] [--cwd <dir>]\n' +
      'Default: dry-run. Prints the git worktree add, the dev --no-ff merge, or worktree remove without running them.\n' +
      '--apply runs those commands. Merge requires a clean dev checkout and does not push. Command output is not printed.\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  const action = args[0]
  if (action !== 'create' && action !== 'merge' && action !== 'remove') {
    process.stdout.write(`${JSON.stringify({ ok: false, dryRun: true, reason: 'invalid_arguments', steps: [] })}\n`)
    process.exitCode = 64
    return
  }
  let track = ''
  let version
  let message
  let apply = false
  let cwd = process.cwd()
  const rest = args.slice(1)
  const positionals = []
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
    else if (arg === '--message' && rest[i + 1] && !rest[i + 1].startsWith('--')) message = rest[++i]
    else if (arg === '--cwd' && rest[i + 1] && !rest[i + 1].startsWith('--')) cwd = resolve(rest[++i])
    else if (arg.startsWith('--')) {
      process.stdout.write(`${JSON.stringify({ ok: false, dryRun: !apply, reason: 'invalid_arguments', steps: [] })}\n`)
      process.exitCode = 64
      return
    } else positionals.push(arg)
  }
  if (action === 'create') {
    track = positionals[0] ?? ''
    version = positionals[1]
    if (positionals.length !== 2) {
      process.stdout.write(`${JSON.stringify({ ok: false, dryRun: !apply, reason: 'invalid_arguments', steps: [] })}\n`)
      process.exitCode = 64
      return
    }
  } else {
    track = positionals[0] ?? ''
    if (positionals.length !== 1) {
      process.stdout.write(`${JSON.stringify({ ok: false, dryRun: !apply, reason: 'invalid_arguments', steps: [] })}\n`)
      process.exitCode = 64
      return
    }
  }
  const result = await runWorktreeTrack({ action, track, version, message, apply, cwd })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) {
    const usageErrors = new Set(['invalid_arguments', 'invalid_track', 'invalid_version', 'message_required'])
    process.exitCode = usageErrors.has(result.reason) ? 64 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, dryRun: true, reason: 'worktree_track_failed', steps: [] })}\n`)
    process.exitCode = 1
  }
}
