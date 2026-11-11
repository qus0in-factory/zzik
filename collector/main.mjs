#!/usr/bin/env node
/**
 * 수집기 조립 루트(ADR 0.2 D10·D11, 운영 제약 개정판).
 * infra 구현을 만들어 app의 runOnce에 주입한다. 로직은 이 파일에 두지 않는다.
 *
 * 실행 모드(PM2 상주가 기본):
 *   (기본)       즉시 1회 실행 후 300초마다 실행(내부 setInterval, 실행이 밀리면 스킵)
 *   --once       1회 실행 후 종료한다. 수동 실행도 게이트를 따른다
 *   --dry-run    상태·KV·로그 어디에도 쓰지 않고 status·키 목록·본문 sha256만 출력한다
 *   --credentials-file <path>  자격 증명 파일 경로 재현(--dry-run과 함께만 허용)
 *
 * KV 쓰기는 이 Mac에 로그인된 wrangler를 실행한다(레포 devDependency, 토큰 파일 없음):
 *   node node_modules/wrangler/bin/wrangler.js kv key put usage:claude \
 *     --path <tmp> --namespace-id <id> --remote
 */

import { createLogAppender } from './infra/usage/log.mjs'
import { createUsageClient } from './infra/usage/usage-client.mjs'
import { createWranglerKvWriter } from './infra/usage/wrangler-kv-writer.mjs'
import { createStateFile } from './infra/usage/state-file.mjs'
import { DEFAULT_CREDENTIALS_PATH, readCredentialsFile } from './infra/usage/credentials-file.mjs'
import { runOnce } from './app/usage/run-once.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VERSION = '0.2.0'
const INTERVAL_MS = 300_000
const KV_NAMESPACE_ID = process.env.ZZIK_KV_NAMESPACE_ID ?? '5fe6ac40c73c4d05ac2fab052c2100e6'
const KV_KEY = process.env.ZZIK_KV_KEY ?? 'usage:claude'
const STATE_PATH = process.env.ZZIK_STATE_PATH ?? join(homedir(), 'Library', 'Application Support', 'zzik', 'usage-state.json')
const LOG_PATH = process.env.ZZIK_LOG_PATH ?? join(homedir(), 'Library', 'Logs', 'zzik', 'usage-collector.log')

const USAGE_TEXT = '사용법: node collector/main.mjs [--once] [--dry-run] [--credentials-file <path>]'

/** @typedef {import('./domain/usage/ports.mjs').CollectorPorts} CollectorPorts */

/**
 * @param {string[]} argv
 * @returns {{ error: string|null, flags: { dryRun: boolean, once: boolean, credentialsPath: string|null } | null }}
 */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean, once: boolean, credentialsPath: string|null }} */
  const flags = { dryRun: false, once: false, credentialsPath: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--once') flags.once = true
    else if (arg === '--credentials-file') {
      flags.credentialsPath = argv[index + 1] ?? null
      index += 1
    } else return { error: `알 수 없는 인자: ${arg}`, flags: null }
  }
  if (flags.credentialsPath !== null && flags.dryRun !== true) {
    return { error: '--credentials-file은 --dry-run과 함께만 쓴다(시험 자격 증명으로 KV에 쓰는 것을 막는다)', flags: null }
  }
  return { error: null, flags }
}

/** @param {{ credentialsPath: string|null }} options @returns {CollectorPorts} */
function buildPorts({ credentialsPath }) {
  const usageClient = createUsageClient({ fetchImpl: (url, init) => fetch(url, init) })
  const kvWriter = createWranglerKvWriter({ namespaceId: KV_NAMESPACE_ID, keyName: KV_KEY })
  return {
    clock: { now: () => Date.now() },
    credentials: {
      readAll: async () => [await readCredentialsFile(credentialsPath ?? DEFAULT_CREDENTIALS_PATH)],
    },
    usage: { fetchUsage: (token) => usageClient.fetchUsage(token) },
    kv: { write: (value) => kvWriter.write(value) },
    state: createStateFile({ path: STATE_PATH }),
    logger: createLogAppender({ path: LOG_PATH }),
  }
}

/** @param {CollectorPorts} ports @param {{ dryRun: boolean }} options */
async function once(ports, { dryRun }) {
  const result = await runOnce(ports, { dryRun, collectorVersion: VERSION })
  const report = result.dryRunReport
  if (report === undefined) {
    process.stderr.write('오류: dry-run 보고서가 없다\n')
    process.exit(1)
    return
  }
  process.stdout.write(
    [
      `status=${report.status}`,
      `called=${report.called ? 1 : 0}`,
      `keys=${JSON.stringify(report.keys)}`,
      `sha256=${report.sha256 ?? 'null'}`,
      '',
    ].join('\n'),
  )
  process.exit(result.exitCode)
}

/** @param {CollectorPorts} ports */
function startResident(ports) {
  let inFlight = false
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
  const tick = async () => {
    if (inFlight) {
      process.stderr.write('[zzik-usage-collector] 이전 실행이 아직 진행 중이라 이번 주기를 건너뛴다\n')
      return
    }
    inFlight = true
    try {
      await runOnce(ports, { collectorVersion: VERSION })
    } catch (error) {
      process.stderr.write(`[zzik-usage-collector] 실행 실패: ${String(error)}\n`)
    } finally {
      inFlight = false
    }
  }
  void tick()
  setInterval(() => {
    void tick()
  }, INTERVAL_MS)
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error !== null || parsed.flags === null) {
    process.stderr.write(`오류: ${parsed.error}\n${USAGE_TEXT}\n`)
    process.exit(64)
    return
  }
  const ports = buildPorts({ credentialsPath: parsed.flags.credentialsPath })
  if (parsed.flags.dryRun) await once(ports, { dryRun: true })
  else if (parsed.flags.once) await once(ports, { dryRun: false })
  else startResident(ports)
}

await main()
