#!/usr/bin/env node
/**
 * Poll a worker result file or Herdr idle/done state (issue #100).
 * macOS has no timeout(1); this process waits itself up to --max-wait-ms.
 * External commands are injectable. Screen text and command output are not printed.
 */
import { statSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { executeCommand } from './lib/exec-command.mjs'

/** @typedef {import('./lib/exec-command.mjs').Executor} Executor */

const AGENT = /^[a-z][a-z0-9_-]{0,31}$/
const READY = new Set(['idle', 'done'])

/**
 * @param {string} stdout
 * @returns {string|null}
 */
export function readAgentStatus(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    const status = parsed?.result?.agent?.agent_status
    return typeof status === 'string' ? status : null
  } catch {
    return null
  }
}

/**
 * @param {string} value
 * @returns {number|null}
 */
function parseSince(value) {
  if (/^\d+$/.test(value)) {
    const ms = Number(value)
    return Number.isSafeInteger(ms) ? ms : null
  }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/**
 * @param {{agent?:string,file?:string,sinceMs?:number,maxWaitMs?:number,intervalMs?:number,now?:()=>number,sleep?:(ms:number)=>Promise<void>,stat?:(file:string)=>number|null,agentStatus?:(agent:string)=>Promise<string|null>,execute?:Executor}} options
 */
export async function waitForResult(options) {
  const agent = options.agent ?? ''
  const file = options.file ?? ''
  const sinceMs = options.sinceMs
  const maxWaitMs = options.maxWaitMs
  if (!AGENT.test(agent) || file === '' || file.startsWith('-')) return { ok: false, reason: 'invalid_arguments', agent, file }
  if (typeof sinceMs !== 'number' || !Number.isSafeInteger(sinceMs) || sinceMs < 0) return { ok: false, reason: 'invalid_arguments', agent, file }
  if (typeof maxWaitMs !== 'number' || !Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 21_600_000) {
    return { ok: false, reason: 'invalid_arguments', agent, file }
  }
  const intervalMs = options.intervalMs ?? 500
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const stat = options.stat ?? ((target) => {
    try {
      return statSync(target).mtimeMs
    } catch {
      return null
    }
  })
  const execute = options.execute ?? executeCommand
  const agentStatus = options.agentStatus ?? (async (name) => {
    const result = await execute('herdr', ['agent', 'get', name], { timeoutMs: 15_000 })
    if (result.exitCode !== 0) return null
    return readAgentStatus(result.stdout)
  })
  const started = now()
  for (;;) {
    const mtime = stat(file)
    if (mtime !== null && mtime > sinceMs) return { ok: true, reason: 'file_updated', agent, file }
    const status = await agentStatus(agent)
    if (status !== null && READY.has(status)) return { ok: true, reason: 'agent_idle', agent, file }
    const elapsed = now() - started
    if (elapsed >= maxWaitMs) return { ok: false, reason: 'wait_timeout', agent, file }
    await sleep(Math.min(intervalMs, maxWaitMs - elapsed))
  }
}

function usage() {
  process.stdout.write(
    'node scripts/herdr-wait-result.mjs --agent <name> --file <path> --since <ms-or-iso> --max-wait-ms <ms>\n' +
      'Polls until the file mtime is newer than --since, or herdr agent get reports idle or done.\n' +
      'Stops at --max-wait-ms. Does not use the timeout command and does not print screen text.\n',
  )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  let agent = ''
  let file = ''
  let since = ''
  let maxWait = ''
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--agent' && args[i + 1] && !args[i + 1].startsWith('--')) agent = args[++i]
    else if (arg === '--file' && args[i + 1] && !args[i + 1].startsWith('--')) file = args[++i]
    else if (arg === '--since' && args[i + 1] && !args[i + 1].startsWith('--')) since = args[++i]
    else if (arg === '--max-wait-ms' && args[i + 1] && !args[i + 1].startsWith('--')) maxWait = args[++i]
    else {
      process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid_arguments' })}\n`)
      process.exitCode = 64
      return
    }
  }
  const sinceMs = parseSince(since)
  const maxWaitMs = /^\d+$/.test(maxWait) ? Number(maxWait) : Number.NaN
  if (sinceMs === null || !Number.isSafeInteger(maxWaitMs)) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'invalid_arguments' })}\n`)
    process.exitCode = 64
    return
  }
  const result = await waitForResult({ agent, file, sinceMs, maxWaitMs })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.ok) process.exitCode = result.reason === 'invalid_arguments' ? 64 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'wait_failed' })}\n`)
    process.exitCode = 1
  }
}
