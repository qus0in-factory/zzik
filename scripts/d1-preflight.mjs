#!/usr/bin/env node
/**
 * Dry-run only D1 cutover preflight checker (ADR 0.10 §11 D).
 * Never mutates state, never calls live PM2/wrangler/DB/D1, and never prints secrets.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const VALID_STORES = new Set(['d1'])
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Bound an async port call using a Node timer (no shell `timeout` dependency).
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @returns {Promise<{ok: true, value: T} | {ok: false, reason: 'timeout' | 'port_error'}>}
 */
async function withNodeTimeout(promise, timeoutMs) {
  let timer
  try {
    const value = await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
    return { ok: true, value }
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.message === 'timeout' ? 'timeout' : 'port_error' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Run all 6 cutover preflight checks over injected ports without exposing raw values.
 * @param {{
 *   pm2: { readProcess(): Promise<{ok: true, value: {status: string, zzikStore: string | null}} | {ok: false, reason: string}> },
 *   ledger: { inspect(stateDir: string): Promise<{ok: true, value: {exists: boolean, marker: string | null, outboxCount: number}} | {ok: false, reason: string}> },
 *   worker: { readDeployment(): Promise<{ok: true, value: {exportDeployed: boolean, bucketDeployed: boolean, usageReadStore: string | null}} | {ok: false, reason: string}> },
 * }} ports
 * @param {{
 *   stateDir: string,
 *   expectedPm2Status?: 'stopped' | 'online' | 'any',
 *   expectedZzikStore?: 'd1',
 *   expectedLedgerExists?: boolean,
 *   expectedReadStore?: 'd1',
 *   timeoutMs?: number,
 * }} options
 */
export async function runD1Preflight(ports, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const expectedPm2Status = options.expectedPm2Status ?? 'any'
  const expectedLedgerExists = options.expectedLedgerExists ?? true

  /** @type {Array<{name: string, status: 'PASS' | 'FAIL', reason?: string}>} */
  const checks = []

  // 1-2. PM2 process status & ZZIK_STORE
  const pm2Call = await withNodeTimeout(ports.pm2.readProcess(), timeoutMs)
  if (!pm2Call.ok || !pm2Call.value.ok) {
    const reason = !pm2Call.ok && pm2Call.reason === 'timeout' ? 'timeout' : 'pm2_unavailable'
    checks.push({ name: 'pm2_process', status: 'FAIL', reason })
    checks.push({ name: 'zzik_store', status: 'FAIL', reason })
  } else {
    const { status, zzikStore } = pm2Call.value.value
    const statusOk = expectedPm2Status === 'any' ? (status === 'online' || status === 'stopped') : status === expectedPm2Status
    checks.push(statusOk ? { name: 'pm2_process', status: 'PASS' } : { name: 'pm2_process', status: 'FAIL', reason: 'pm2_status_mismatch' })

    const storeValid = typeof zzikStore === 'string' && VALID_STORES.has(zzikStore)
    const storeMatches = options.expectedZzikStore === undefined ? storeValid : zzikStore === options.expectedZzikStore
    checks.push(storeMatches ? { name: 'zzik_store', status: 'PASS' } : { name: 'zzik_store', status: 'FAIL', reason: 'invalid_zzik_store' })
  }

  // 3-4. Ledger existence & outbox == 0
  const ledgerCall = await withNodeTimeout(ports.ledger.inspect(options.stateDir), timeoutMs)
  if (!ledgerCall.ok || !ledgerCall.value.ok) {
    const reason = !ledgerCall.ok && ledgerCall.reason === 'timeout' ? 'timeout' : 'ledger_unavailable'
    checks.push({ name: 'ledger_exists', status: 'FAIL', reason })
    checks.push({ name: 'ledger_outbox_zero', status: 'FAIL', reason })
  } else {
    const { exists, marker, outboxCount } = ledgerCall.value.value
    // A missing/corrupt D1 ledger always fails this read-only gate.
    const existsOk = exists === expectedLedgerExists
    checks.push(existsOk ? { name: 'ledger_exists', status: 'PASS' } : { name: 'ledger_exists', status: 'FAIL', reason: 'ledger_missing' })

    const outboxOk = exists === true && Number.isSafeInteger(outboxCount) && outboxCount === 0
    checks.push(outboxOk ? { name: 'ledger_outbox_zero', status: 'PASS' } : { name: 'ledger_outbox_zero', status: 'FAIL', reason: exists === true ? 'ledger_outbox_non_empty' : 'ledger_missing' })
  }

  // 5-6. Worker export/bucket deployment & USAGE_READ_STORE
  const workerCall = await withNodeTimeout(ports.worker.readDeployment(), timeoutMs)
  if (!workerCall.ok || !workerCall.value.ok) {
    const reason = !workerCall.ok && workerCall.reason === 'timeout' ? 'timeout' : 'worker_unavailable'
    checks.push({ name: 'export_bucket_deployed', status: 'FAIL', reason })
    checks.push({ name: 'usage_read_store', status: 'FAIL', reason })
  } else {
    const { exportDeployed, bucketDeployed, usageReadStore } = workerCall.value.value
    const deployedOk = exportDeployed === true && bucketDeployed === true
    checks.push(deployedOk ? { name: 'export_bucket_deployed', status: 'PASS' } : { name: 'export_bucket_deployed', status: 'FAIL', reason: 'export_or_bucket_not_deployed' })

    const readValid = typeof usageReadStore === 'string' && VALID_STORES.has(usageReadStore)
    const readMatches = options.expectedReadStore === undefined ? readValid : usageReadStore === options.expectedReadStore
    checks.push(readMatches ? { name: 'usage_read_store', status: 'PASS' } : { name: 'usage_read_store', status: 'FAIL', reason: 'invalid_read_store' })
  }

  return {
    ok: checks.every((check) => check.status === 'PASS'),
    dryRun: /** @type {const} */ (true),
    checks,
  }
}

function createReadOnlyLedgerInspector() {
  return {
    async inspect(stateDir) {
      const dbPath = join(stateDir, 'collector-ledger.sqlite')
      const markerPath = join(stateDir, 'collector-ledger.marker.json')
      const markerExists = existsSync(markerPath)
      const marker = markerExists ? JSON.parse(readFileSync(markerPath, 'utf8'))?.status ?? 'invalid' : null
      if (markerExists && !['active','rolled-back'].includes(marker)) return {ok:false,reason:'invalid_ledger_marker'}
      if (!existsSync(dbPath)) {
        if (markerExists) return {ok:false,reason:'ledger_missing_with_marker'}
        return { ok: true, value: { exists: false, marker: null, outboxCount: 0 } }
      }
      if (statSync(dbPath).size === 0) return {ok:false,reason:'empty_ledger'}
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const row = db.prepare('SELECT count(*) AS n FROM outbox').get()
        return { ok: true, value: { exists: true, marker, outboxCount: Number(row?.n ?? 0) } }
      } finally {
        db.close()
      }
    },
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    process.stdout.write(
      'node scripts/d1-preflight.mjs --state-dir <directory> [--evidence <json-path>]\n' +
      '  [--expected-pm2-status online|stopped|any] [--expected-zzik-store d1] [--expected-read-store d1]\n' +
      'Defaults: --expected-pm2-status online --expected-zzik-store d1 --expected-read-store d1 (D1-only).\n' +
      'Dry-run only: never calls live PM2/wrangler/DB/D1 and never prints secrets.\n',
    )
    return
  }
  let stateDir = null
  let evidencePath = null
  let expectedPm2Status = 'online'
  let expectedZzikStore = 'd1'
  let expectedReadStore = 'd1'
  const pm2Statuses = new Set(['online', 'stopped', 'any'])
  const stores = new Set(['d1'])
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--state-dir' && args[i + 1]) stateDir = resolve(args[++i])
    else if (args[i] === '--evidence' && args[i + 1]) evidencePath = resolve(args[++i])
    else if (args[i] === '--expected-pm2-status' && args[i + 1] && pm2Statuses.has(args[i + 1])) expectedPm2Status = args[++i]
    else if (args[i] === '--expected-zzik-store' && args[i + 1] && stores.has(args[i + 1])) expectedZzikStore = args[++i]
    else if (args[i] === '--expected-read-store' && args[i + 1] && stores.has(args[i + 1])) expectedReadStore = args[++i]
    else {
      process.stdout.write(JSON.stringify({ ok: false, dryRun: true, reason: 'invalid_arguments' }) + '\n')
      process.exitCode = 64
      return
    }
  }
  if (stateDir === null) {
    process.stdout.write(JSON.stringify({ ok: false, dryRun: true, reason: 'state_directory_required' }) + '\n')
    process.exitCode = 64
    return
  }
  const evidence = evidencePath === null ? null : JSON.parse(readFileSync(evidencePath, 'utf8'))
  const ports = {
    pm2: {
      async readProcess() {
        return evidence?.pm2 ? { ok: true, value: evidence.pm2 } : { ok: false, reason: 'not_provided' }
      },
    },
    ledger: createReadOnlyLedgerInspector(),
    worker: {
      async readDeployment() {
        return evidence?.worker ? { ok: true, value: evidence.worker } : { ok: false, reason: 'not_provided' }
      },
    },
  }
  const result = await runD1Preflight(ports, { stateDir, expectedPm2Status, expectedZzikStore, expectedReadStore })
  process.stdout.write(JSON.stringify(result) + '\n')
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ ok: false, dryRun: true, reason: 'preflight_failed' }) + '\n')
    process.exitCode = 1
  })
}
