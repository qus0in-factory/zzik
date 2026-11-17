#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { createWranglerOAuthFile, defaultWranglerOAuthPath } from '../collector/infra/usage/wrangler-oauth-file.mjs'
import { createWranglerOAuthRefresh } from '../collector/infra/usage/wrangler-oauth-refresh.mjs'
import { createWranglerOAuthCredentials } from '../collector/app/usage/d1-oauth-credentials.mjs'
import { createD1RestClient } from '../collector/infra/usage/d1-rest-client.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const tables = ['trend_section', 'trend_source_state', 'trend_model_seen', 'trend_plan_observation', 'trend_aa_snapshot', 'trend_or_ranking']

function validateStatement({ sql, params }) {
  if (Buffer.byteLength(sql) > 100_000 || params.length > 100 || params.some(value => typeof value === 'string' && Buffer.byteLength(value) > 2_000_000)) throw Error('d1_statement_limit')
}
export function createDatabasePort({ apply, local, remote }) {
  let writes = 0, seenWrites = 0, writeRequests = 0
  let pending = [], failed = false, failedRequest = null
  function validate(statement) {
    try { validateStatement(statement) } catch { failed = true; throw Error('d1_statement_limit') }
  }
  async function send(statements) {
    for (const statement of statements) validate(statement)
    try { return await remote(statements) } catch {
      failed = true
      const kinds = [['trend_model_seen', 'seen'], ['trend_plan_observation', 'plan'], ['trend_aa_snapshot', 'aa'], ['trend_or_ranking', 'or'], ['trend_section', 'section'], ['trend_source_state', 'source']]
      const kind = kinds.find(([table]) => statements.every(s => s.sql.includes(table)))?.[1] ?? 'other'
      failedRequest = { kind, statements: statements.length, maxBindings: Math.max(...statements.map(s => s.params.length)), maxSqlBytes: Math.max(...statements.map(s => Buffer.byteLength(s.sql))), maxStringBytes: Math.max(0, ...statements.flatMap(s => s.params.filter(v => typeof v === 'string').map(v => Buffer.byteLength(v)))) }
      throw Error('d1_query_failed')
    }
  }
  async function flush() {
    if (!apply) return
    while (pending.length) {
      const chunk = pending.slice(0, 100)
      writeRequests++
      await send(chunk)
      writes += chunk.length
      pending = pending.slice(chunk.length)
    }
  }
  function prepare(sql) {
    return { bind(...params) {
      const statement = { sql, params }
      return { statement, async all() {
        validate(statement)
        if (!/^\s*SELECT\b/i.test(sql)) throw Error('read_only_query_required')
        if (!apply) return local.prepare(sql).bind(...params).all()
        await flush()
        const result = await send([statement]); return result[0]
      }, async run() {
        validate(statement)
        const seen = /^\s*INSERT\s+INTO\s+trend_model_seen\b/i.test(sql)
        if (seen) seenWrites++
        if (!apply) return local.prepare(sql).bind(...params).run()
        if (seen) {
          pending.push(statement)
          if (pending.length >= 100) await flush()
          return { success: true }
        }
        await flush()
        writeRequests++; const result = await send([statement]); writes++
        return result[0]
      } }
    } }
  }
  return { prepare, async batch(statements) {
    if (!apply) return Promise.all(statements.map(s => s.run()))
    await flush()
    writeRequests++; const result = await send(statements.map(s => s.statement)); writes += statements.length
    return result
  }, async flush() { await flush(); if (failed) throw Error('d1_query_failed') }, remoteWrites: () => writes, seenWrites: () => seenWrites, writeRequests: () => writeRequests, failedRequest: () => failedRequest }
}

function sqlitePort(db) {
  return { prepare(sql) { return { bind(...params) { return {
    async all() { return { success: true, results: db.prepare(sql).all(...params) } },
    async run() { db.prepare(sql).run(...params); return { success: true } },
  } } } } }
}
function envFile() {
  const ownEnv = new URL('../.env', import.meta.url)
  const workspaceEnv = new URL('../../../.env', import.meta.url)
  const lines = readFileSync(existsSync(ownEnv) ? ownEnv : workspaceEnv, 'utf8').split(/\r?\n/)
  const values = {}
  for (const line of lines) {
    const match = line.match(/^\s*(AA_API_KEY|OR_API_KEY|ZZIK_D1_ACCOUNT_ID|ZZIK_D1_DATABASE_ID)\s*=\s*(.*?)\s*$/)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}
let stage = "arguments", activePort = null
async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply') || args.length > 1) throw Error('invalid_arguments')
  stage = "configuration"
  const apply = args.includes('--apply'), env = envFile()
  if (!env.ZZIK_D1_ACCOUNT_ID || !env.ZZIK_D1_DATABASE_ID) throw Error('missing_d1_config')
  let state = { credentialKey: null, authStopped: false, nextRequestAtMs: 0 }
  const clock = { now: () => Date.now() }
  const credentials = createWranglerOAuthCredentials({ file: createWranglerOAuthFile({ path: defaultWranglerOAuthPath('zzik-collector') }), refresh: createWranglerOAuthRefresh({ profile: 'zzik-collector' }), clock })
  const client = createD1RestClient({ mode: 'd1', dryRun: false, accountId: env.ZZIK_D1_ACCOUNT_ID, databaseId: env.ZZIK_D1_DATABASE_ID, credentials, clock, control: { read: () => ({ ok: true, value: state }), write: next => { state = next; return { ok: true } } }, wait: ms => new Promise(resolve => setTimeout(resolve, ms)), fetch: globalThis.fetch })
  const remote = async statements => { for (const statement of statements) validateStatement(statement); const result = await client.query(statements); if (!result.ok) { stage = 'd1_' + result.reason + (result.status ?? ''); throw Error('d1_query_failed') } return result.value }
  let local = null, initialPlanObservations = null
  if (!apply) {
    const db = new DatabaseSync(':memory:')
    for (const file of ['0002_trend.sql', '0003-trend-plan-observation.sql', '0004_metrics.sql']) db.exec(readFileSync(new URL(`../worker/migrations/${file}`, import.meta.url), 'utf8'))
    stage = "remote_read"
    const snapshots = await remote(tables.map(table => ({ sql: `SELECT * FROM ${table}`, params: [] })))
    initialPlanObservations = snapshots[3].results.reduce((counts, row) => { counts[row.baseline === 1 ? 'baseline' : 'other']++; return counts }, { baseline: 0, other: 0 })
    for (let i = 0; i < tables.length; i++) for (const row of snapshots[i].results) {
      const columns = Object.keys(row)
      db.prepare(`INSERT INTO ${tables[i]} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row))
    }
    local = sqlitePort(db)
  }
  const port = createDatabasePort({ apply, local, remote })
  activePort = port
  stage = "bundle"
  const built = await build({ entryPoints: [root + 'scripts/trend-refresh-runtime.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' })
  const runtime = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
  stage = "refresh"
  const result = await runtime.refresh(port, { aa: env.AA_API_KEY ?? '', or: env.OR_API_KEY ?? '' }, Date.now(), globalThis.fetch)
  await port.flush()
  process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', initialPlanObservations, ...result, remoteWrites: port.remoteWrites(), seenWrites: port.seenWrites(), seenWriteRequestsEstimate: Math.ceil(port.seenWrites() / 100), writeRequests: port.writeRequests() }) + '\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { process.stderr.write(JSON.stringify({ error: 'trend_refresh_failed', stage, remoteWrites: activePort?.remoteWrites() ?? 0, writeRequests: activePort?.writeRequests() ?? 0, failedRequest: activePort?.failedRequest() ?? null }) + '\n'); process.exitCode = 1 })
