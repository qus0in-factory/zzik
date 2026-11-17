#!/usr/bin/env node
/**
 * Release -> merge -> release sync -> scoped deploy/collector -> Discord notification (issue #106).
 * Defaults to a no-write dry-run. --apply performs the ship flow.
 * Outputs a single-line JSON summary and never forwards child stdout/stderr or secrets.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executeCommand } from './lib/exec-command.mjs'
import { verifyRequestBody } from './verify-request.mjs'

/** @typedef {import('./lib/exec-command.mjs').Executor} Executor */
/** @typedef {{deployWorker:boolean,trendRefill:boolean,applyCollector:boolean,hasUi:boolean,defaultKind:'verify'|'done'}} ShipScope */
/** @typedef {{name:string,status:'PLAN'|'PASS'|'FAIL'|'SKIP',command?:readonly string[]}} ShipStep */

/** @param {readonly string[]} files @returns {ShipScope} */
export function classifyShipScope(files) {
  const has = (pred) => files.some(pred)
  const deployWorker = has((f) => f === 'wrangler.jsonc' || f.startsWith('worker/') || f.startsWith('src/') || f.startsWith('shared/'))
  const trendRefill = has((f) => f.startsWith('worker/domain/trend/') || f.startsWith('worker/app/trend/') || f.startsWith('worker/infra/trend/') || /^shared\/trend-[^/]*\.ts$/.test(f))
  const applyCollector = has((f) => f.startsWith('collector/') || f.startsWith('shared/'))
  const hasUi = has((f) => f.startsWith('src/'))
  return { deployWorker, trendRefill, applyCollector, hasUi, defaultKind: hasUi ? 'verify' : 'done' }
}

/** @param {string} dir @returns {string|null} */
function readPackageVersion(dir) {
  try {
    const raw = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
    return typeof raw?.version === 'string' ? raw.version : null
  } catch {
    return null
  }
}

/** @param {string} summary @param {readonly string[]} issues */
function formatSummary(summary, issues) {
  const base = summary.trim()
  if (issues.length === 0 || base === '') return base
  const refs = issues.map((id) => `#${id.replace(/^#/, '')}`).join(', ')
  return `${base} (${refs})`
}

/**
 * @param {{
 *   apply?:boolean,
 *   notifyFailure?:boolean,
 *   kind?:'verify'|'done',
 *   summary?:string,
 *   checks?:readonly string[],
 *   issues?:readonly string[],
 *   changedFiles?:readonly string[],
 *   version?:string,
 *   cwd?:string,
 *   releaseDir?:string,
 *   execute?:Executor,
 * }} [options]
 */
export async function runShip(options = {}) {
  const dryRun = options.apply !== true
  const cwd = resolve(options.cwd ?? process.cwd())
  const releaseDir = resolve(options.releaseDir ?? resolve(cwd, '.worktree/release'))
  const execute = options.execute ?? executeCommand
  const issues = options.issues ?? []
  const userChecks = options.checks ?? []
  const summaryText = (options.summary ?? '').trim()

  if (dryRun) {
    const scope = classifyShipScope(options.changedFiles ?? [])
    const kind = options.kind ?? scope.defaultKind
    /** @type {ShipStep[]} */
    const steps = [
      { name: 'release_prep', status: 'PLAN', command: ['node', 'scripts/release-prep.mjs', '--apply'] },
      { name: 'pr_merge', status: 'PLAN', command: ['gh', 'pr', 'merge', '--merge'] },
      { name: 'release_sync', status: 'PLAN', command: ['git', 'pull', '--ff-only'] },
      ...(scope.deployWorker ? [{ name: 'deploy_worker', status: /** @type {'PLAN'} */ ('PLAN'), command: ['node', 'scripts/deploy-verify.mjs', '--deploy', '--release', '<release>'] }] : []),
      ...(scope.trendRefill ? [{ name: 'trend_refill', status: /** @type {'PLAN'} */ ('PLAN'), command: ['node', 'scripts/trend-refresh-once.mjs', '--apply'] }] : [{ name: 'trend_refill', status: /** @type {'SKIP'} */ ('SKIP') }]),
      ...(scope.applyCollector ? [{ name: 'apply_collector', status: /** @type {'PLAN'} */ ('PLAN'), command: ['node', 'scripts/collector-apply.mjs', '--apply'] }] : []),
      { name: 'verify_request', status: 'PLAN' },
      { name: 'notify_discord', status: 'PLAN', command: ['scripts/notify-discord.sh'] },
    ]
    return { ok: true, dryRun: true, kind, scope, steps }
  }

  /** @param {string} stage */
  async function fail(stage) {
    if (options.notifyFailure === true) {
      try {
        await execute('scripts/notify-discord.sh', [`[zzik] 배포 실패 (${stage})`, `단계 ${stage}에서 중단되었습니다.`], { cwd, timeoutMs: 60_000 })
      } catch {
        // Keep the original failing stage name.
      }
    }
    return { ok: false, dryRun: false, stage }
  }

  /** @type {ShipStep[]} */
  const steps = []
  const autoChecks = ['release-prep --apply 통과']

  const prep = await execute('node', ['scripts/release-prep.mjs', '--apply'], { cwd, timeoutMs: 1_800_000 })
  if (prep.exitCode !== 0) return fail('release_prep')
  steps.push({ name: 'release_prep', status: 'PASS' })

  const merge = await execute('gh', ['pr', 'merge', '--merge'], { cwd, timeoutMs: 120_000 })
  if (merge.exitCode !== 0) return fail('pr_merge')
  steps.push({ name: 'pr_merge', status: 'PASS' })

  const beforeSha = await execute('git', ['rev-parse', 'HEAD'], { cwd: releaseDir, timeoutMs: 30_000 })
  const pull = await execute('git', ['pull', '--ff-only'], { cwd: releaseDir, timeoutMs: 120_000 })
  if (pull.exitCode !== 0) return fail('release_sync')
  const install = await execute('pnpm', ['install', '--frozen-lockfile'], { cwd: releaseDir, timeoutMs: 300_000 })
  if (install.exitCode !== 0) return fail('release_sync')
  const clean = await execute('git', ['status', '--porcelain'], { cwd: releaseDir, timeoutMs: 30_000 })
  if (clean.exitCode !== 0 || clean.stdout.trim() !== '') return fail('release_sync')
  steps.push({ name: 'release_sync', status: 'PASS' })

  const baseRef = beforeSha.exitCode === 0 && beforeSha.stdout.trim() !== '' ? beforeSha.stdout.trim() : 'HEAD~1'
  const diff = await execute('git', ['diff', '--name-only', `${baseRef}..HEAD`], { cwd: releaseDir, timeoutMs: 30_000 })
  if (diff.exitCode !== 0) return fail('scope')
  const changedFiles = diff.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const scope = classifyShipScope(changedFiles)
  const kind = options.kind ?? scope.defaultKind
  steps.push({ name: 'scope', status: 'PASS' })

  if (scope.deployWorker) {
    const deploy = await execute('node', ['scripts/deploy-verify.mjs', '--deploy', '--release', releaseDir], { cwd: releaseDir, timeoutMs: 600_000 })
    if (deploy.exitCode !== 0) return fail('deploy_worker')
    steps.push({ name: 'deploy_worker', status: 'PASS' })
    autoChecks.push('deploy-verify --deploy 통과')
  }

  if (scope.trendRefill) {
    const refill = await execute('node', ['scripts/trend-refresh-once.mjs', '--apply'], { cwd: releaseDir, timeoutMs: 1_200_000 })
    if (refill.exitCode !== 0) return fail('trend_refill')
    steps.push({ name: 'trend_refill', status: 'PASS' })
    autoChecks.push('trend-refresh-once --apply 통과')
  } else {
    steps.push({ name: 'trend_refill', status: 'SKIP' })
  }

  if (scope.applyCollector) {
    const collector = await execute('node', ['scripts/collector-apply.mjs', '--apply'], { cwd: releaseDir, timeoutMs: 1_200_000 })
    if (collector.exitCode !== 0) return fail('apply_collector')
    steps.push({ name: 'apply_collector', status: 'PASS' })
    autoChecks.push('collector-apply --apply 통과')
  }

  const version = options.version ?? readPackageVersion(releaseDir) ?? readPackageVersion(cwd) ?? ''
  const fullSummary = formatSummary(summaryText, issues)
  const allChecks = [...userChecks, ...autoChecks]
  const built = verifyRequestBody({ version, summary: fullSummary, checks: allChecks, done: kind === 'done' })
  if (!built.ok) return fail('verify_request')
  steps.push({ name: 'verify_request', status: 'PASS' })

  const headline = summaryText || fullSummary
  const title = kind === 'verify' ? `[zzik ${version}] 확인 요청: ${headline}` : `[zzik ${version}] ${headline}`
  const notify = await execute('scripts/notify-discord.sh', [title, built.body], { cwd, timeoutMs: 60_000 })
  if (notify.exitCode !== 0) return fail('notify_discord')
  steps.push({ name: 'notify_discord', status: 'PASS' })

  return { ok: true, dryRun: false, version, kind, scope, steps }
}

/** @param {readonly string[]} args @param {Record<string, unknown>} [ports] */
export async function shipMain(args = process.argv.slice(2), ports = {}) {
  const write = typeof ports.write === 'function' ? ports.write : (/** @type {string} */ line) => process.stdout.write(line)
  let result
  let code = 0
  try {
    /** @type {{apply?:boolean,dryRun?:boolean,notifyFailure?:boolean,kind?:'verify'|'done',summary?:string,checks:string[],issues:string[],releaseDir?:string}} */
    const parsed = { checks: [], issues: [] }
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]
      if (arg === '--apply') parsed.apply = true
      else if (arg === '--dry-run') parsed.dryRun = true
      else if (arg === '--notify-failure') parsed.notifyFailure = true
      else if (arg === '--kind') {
        const next = args[++i]
        if (next !== 'verify' && next !== 'done') throw Error('arguments')
        parsed.kind = next
      } else if (arg === '--summary' && args[i + 1] && !args[i + 1].startsWith('--')) parsed.summary = args[++i]
      else if (arg === '--check' && args[i + 1] && !args[i + 1].startsWith('--')) parsed.checks.push(args[++i])
      else if (arg === '--issues' && args[i + 1] && !args[i + 1].startsWith('--')) {
        parsed.issues.push(...args[++i].split(',').map((s) => s.trim()).filter(Boolean))
      } else if (arg === '--release' && args[i + 1] && !args[i + 1].startsWith('--')) parsed.releaseDir = resolve(args[++i])
      else throw Error('arguments')
    }
    if (parsed.apply && parsed.dryRun) throw Error('arguments')
    result = await runShip({ ...ports, ...parsed })
    code = result.ok ? 0 : 1
  } catch {
    result = { ok: false, dryRun: !args.includes('--apply') || args.includes('--dry-run'), stage: 'arguments' }
    code = 64
  }
  write(JSON.stringify(result) + '\n')
  return code
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await shipMain()
}
