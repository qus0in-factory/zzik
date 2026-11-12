#!/usr/bin/env node
/**
 * 수집기 조립 루트(ADR 0.3 D3 다중 제공자 + D9 조립 배정).
 * 제공자 정의(claude/codex/antigravity)를 만들어 runCycle에 주입한다. 로직은 이 파일에 두지 않는다.
 *
 * 실행 모드(PM2 상주가 기본):
 *   (기본)       즉시 1회 실행 후 900초마다 runCycle(제공자 수만큼 줄이 생긴다)
 *   --once       1회 실행 후 종료한다. 종료 코드는 제공자별 결과 중 가장 큰 값
 *   --dry-run    상태·KV·로그 어디에도 쓰지 않는다(--provider와 같이 쓰면 경로 목록 출력)
 *   --provider <id>   대상 제공자(claude|codex|antigravity). 생략하면 켜진 제공자 전부
 *   --credentials-file <path>  자격 증명 파일 재현(--provider와 --dry-run이 함께 있을 때만)
 *
 * 제공자 목록: env ZZIK_PROVIDERS(기본 'claude,codex,antigravity'). 하나의 제공자 실패가 다른
 * 제공자를 막지 않는다(예외 격리, 제공자별 상태 파일·게이트).
 *
 * KV 쓰기는 이 Mac에 로그인된 wrangler를 실행한다(키는 제공자 id에서 정해진다):
 *   node node_modules/wrangler/bin/wrangler.js kv key put usage:<provider> \
 *     --path <tmp> --namespace-id <id> --remote
 */

import postgres from 'postgres'
import { createPostgresEnvelopeWriter } from './infra/usage/postgres-envelope-writer.mjs'
import { createFanoutWriter } from './infra/usage/fanout-writer.mjs'
import { readStorageConfig } from './domain/usage/storage-config.mjs'
import { createLogAppender } from './infra/usage/log.mjs'
import { createUsageClient as createClaudeUsageClient } from './infra/usage/claude-usage-client.mjs'
import { createAntigravityUsageClient, ANTIGRAVITY_API_HOSTS } from './infra/usage/antigravity-usage-client.mjs'
import { DEFAULT_ANTIGRAVITY_AUTH_PATH, readAntigravityCredentials } from './infra/usage/antigravity-credentials-file.mjs'
import { createCodexUsageClient } from './infra/usage/codex-usage-client.mjs'
import { createWranglerKvWriter } from './infra/usage/wrangler-kv-writer.mjs'
import { createStateFile } from './infra/usage/state-file.mjs'
import { DEFAULT_CREDENTIALS_PATH, readCredentialsFile } from './infra/usage/claude-credentials-file.mjs'
import { DEFAULT_CODEX_AUTH_PATH, readCodexCredentials } from './infra/usage/codex-credentials-file.mjs'
import { runCycle } from './app/usage/run-cycle.mjs'
import { buildProviderBundles } from './app/usage/provider-bundles.mjs'
import { USAGE_KV_KEYS, USAGE_COLLECTOR_VERSION, USAGE_REDACTION_PATHS, USAGE_PROVIDERS as PROVIDER_IDS, parseProvidersEnv } from './domain/usage/providers.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const VERSION = USAGE_COLLECTOR_VERSION
/** @type {{mode:'kv'|'postgres'|'both',intervalSec:number,retentionDays:number}} */
let storageConfig = {mode:'both',intervalSec:900,retentionDays:30}
/** @type {ReturnType<typeof postgres>|null} */
let database = null
/** @type {ReturnType<typeof createPostgresEnvelopeWriter>|null} */
let postgresWriter = null
/** @type {NonNullable<Parameters<typeof runCycle>[0]['maintenance']>|undefined} */
let maintenance
const KV_NAMESPACE_ID = process.env.ZZIK_KV_NAMESPACE_ID ?? '5fe6ac40c73c4d05ac2fab052c2100e6'
const STATE_DIR = process.env.ZZIK_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'zzik')
const LOG_PATH = process.env.ZZIK_LOG_PATH ?? join(homedir(), 'Library', 'Logs', 'zzik', 'usage-collector.log')

/** @param {string} value @returns {string} */
function resolveHomePath(value) {
  if (value.startsWith('~')) return join(homedir(), value.slice(1))
  return value
}

const ANTIGRAVITY_AUTH_PATH = process.env.ZZIK_ANTIGRAVITY_AUTH_PATH ? resolveHomePath(process.env.ZZIK_ANTIGRAVITY_AUTH_PATH) : DEFAULT_ANTIGRAVITY_AUTH_PATH
const ANTIGRAVITY_HOST = process.env.ZZIK_ANTIGRAVITY_API_HOST ?? 'cloudcode-pa.googleapis.com'
if (!ANTIGRAVITY_API_HOSTS.includes(ANTIGRAVITY_HOST)) {
  process.stderr.write('Invalid Antigravity API host\n')
  process.exit(78)
}
const CODEX_AUTH_PATH = process.env.ZZIK_CODEX_AUTH_PATH ? resolveHomePath(process.env.ZZIK_CODEX_AUTH_PATH) : DEFAULT_CODEX_AUTH_PATH

/**
 * 켜진 제공자 목록(ZZIK_PROVIDERS 해석: 소문자·중복 제거·모르는 값 경고, ADR 0.3 v2 D3).
 * 결과가 비면 설정 오류로 끝낸다(종료 코드 78).
 */
const parsedProviders = parseProvidersEnv(process.env.ZZIK_PROVIDERS)
for (const unknownValue of parsedProviders.warnings) {
  process.stderr.write(`[zzik-usage-collector] ZZIK_PROVIDERS에 목록에 없는 값이 있다: ${unknownValue}
`)
}
const enabledProviders = parsedProviders.providers
if (enabledProviders.length === 0) {
  process.stderr.write('[zzik-usage-collector] ZZIK_PROVIDERS 해석 결과가 비었다. claude,codex,antigravity 형식으로 설정한다\n')
  process.exit(78)
}

const USAGE_TEXT = '사용법: node collector/main.mjs [--once] [--dry-run] [--provider claude|codex|antigravity] [--credentials-file <path>]'

/** @typedef {import('./domain/usage/ports.mjs').CollectorPorts} CollectorPorts */
/** @typedef {{ dryRun: boolean, once: boolean, credentialsPath: string|null, provider: string|null, codexAccountHeader: boolean }} ParsedFlags */

/**
 * @param {string[]} argv
 * @returns {{ error: string|null, flags: ParsedFlags | null }}
 */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean, once: boolean, credentialsPath: string|null, provider: string|null, codexAccountHeader: boolean }} */
  const flags = { dryRun: false, once: false, credentialsPath: null, provider: null, codexAccountHeader: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--codex-account-header') flags.codexAccountHeader = true
    else if (arg === '--once') flags.once = true
    else if (arg === '--provider') {
      const value = /** @type {string|null} */ (argv[index + 1] ?? null)
      if (value === null || !PROVIDER_IDS.includes(value)) return { error: `알 수 없는 제공자: ${value ?? '(없음)'}`, flags: null }
      flags.provider = value
      index += 1
    } else if (arg === '--credentials-file') {
      flags.credentialsPath = argv[index + 1] ?? null
      index += 1
    } else return { error: `알 수 없는 인자: ${arg}`, flags: null }
  }
  if (flags.credentialsPath !== null && (flags.dryRun !== true || flags.provider === null)) {
    return { error: '--credentials-file은 --provider와 --dry-run이 함께 있을 때만 쓴다(시험 자격 증명으로 다른 제공자의 KV에 쓰는 일을 막는다)', flags: null }
  }
  if (flags.codexAccountHeader === true && flags.dryRun !== true) {
    return { error: '--codex-account-header는 --dry-run과 함께만 쓴다(G2 진단용)', flags: null }
  }
  return { error: null, flags }
}

/**
 * 제공자 하나의 포트 묶음(ADR 0.3 D3의 표). 자격 증명 포트·usage 포트·KV 키·상태 파일이
 * 제공자별로 다르고 나머지(시계, 로거, KV 어댑터)는 공유한다.
 * @param {string} provider
 * @param {{ credentialsPath: string|null }} options
 * @returns {CollectorPorts}
 */
function buildProviderPorts(provider, { credentialsPath }) {
  const providerId = /** @type {keyof typeof USAGE_KV_KEYS} */ (provider)
  const kvWriter = createWranglerKvWriter({ namespaceId: KV_NAMESPACE_ID, keyName: USAGE_KV_KEYS[providerId] })
  const usageClient =
    provider === 'antigravity'
      ? createAntigravityUsageClient({ fetchImpl: globalThis.fetch, host: ANTIGRAVITY_HOST, project: process.env.ZZIK_ANTIGRAVITY_PROJECT ?? 'default-cli-project' })
      : provider === 'codex'
      ? createCodexUsageClient({ fetchImpl: globalThis.fetch })
      : createClaudeUsageClient({ fetchImpl: globalThis.fetch })
  /** @param {string} message @returns {void} */
  const warn = (message) => {
    process.stderr.write(`[zzik-usage-collector] warn: ${message}\n`)
  }
  return {
    clock: { now: () => Date.now() },
    credentials: {
      readAll: async () => {
        if (provider === 'antigravity') return [await readAntigravityCredentials(credentialsPath ?? ANTIGRAVITY_AUTH_PATH, { warn })]
        if (provider === 'codex') return [await readCodexCredentials(credentialsPath ?? CODEX_AUTH_PATH, { warn })]
        return [await readCredentialsFile(credentialsPath ?? DEFAULT_CREDENTIALS_PATH)]
      },
    },
    usage: { fetchUsage: (token, opts) => usageClient.fetchUsage(token, opts) },
    store: postgresWriter === null || storageConfig.mode === 'kv'
      ? kvWriter
      : storageConfig.mode === 'postgres'
        ? postgresWriter
        : createFanoutWriter([kvWriter, postgresWriter]),
    state: createStateFile({
      path: join(STATE_DIR, `usage-state.${provider}.json`),
      // 0.2에서 claude 전용으로 쓰던 파일의 일회성 이행(D3).
      legacyPath: provider === 'claude' ? join(STATE_DIR, 'usage-state.json') : undefined,
    }),
    logger: createLogAppender({ path: LOG_PATH }),
  }
}

/**
 * 활성 제공자들의 포트 묶음 + 실행 옵션(가림 목록·계정 헤더) 배선.
 * 실제 조립은 app/usage/provider-bundles.mjs의 순수 함수가 하고, 이 파일은
 * 환경값(제공자 목록·credentialsPath·계정 헤더 플래그)을 넘겨주는 배선 장소다.
 * @param {ParsedFlags} flags @returns {ReturnType<typeof buildProviderBundles>}
 */
function buildProviders(flags) {
  return buildProviderBundles({
    providerIds: enabledProviders,
    flags: { provider: flags.provider, credentialsPath: flags.credentialsPath, codexAccountHeader: flags.codexAccountHeader },
    envSendAccountId: process.env.ZZIK_CODEX_SEND_ACCOUNT_ID === '1',
    redactionPaths: USAGE_REDACTION_PATHS,
    buildPorts: (providerId) => buildProviderPorts(providerId, { credentialsPath: flags.credentialsPath }),
  })
}

/** @param {ParsedFlags} flags @returns {Promise<void>} */
async function once(flags) {
  const intervalSec = storageConfig.intervalSec
  const { results } = await runCycle({maintenance}, buildProviders(flags), {
    dryRun: flags.dryRun,
    collectorVersion: VERSION,
    intervalSec,
  })
  for (const result of results) {
    if (flags.dryRun) {
      const report = /** @type {{ provider: string, status: string, called: boolean, keys: string[], sha256: string|null, diag?: string|null }} */ (result.dryRunReport ?? { provider: result.id, status: 'unknown', called: false, keys: [], sha256: null })
      const lines = [
        `provider=${result.id}`,
        `status=${report.status}`,
        `called=${report.called ? 1 : 0}`,
        `keys=${JSON.stringify(report.keys ?? [])}`,
        `sha256=${report.sha256 ?? 'null'}`,
      ]
      if (report.diag !== null && report.diag !== undefined) lines.push(`diag=${report.diag}`)
      process.stdout.write([...lines, ''].join('\n'))
    } else {
      process.stdout.write(`provider=${result.id} exit=${result.exitCode}\n`)
    }
  }
  await database?.end({timeout:1})
  process.exit(Math.max(0, ...results.map((result) => result.exitCode)))
}

function startResident() {
  let inFlight = false
  process.on('SIGINT', () => process.exit(0))
  process.on('SIGTERM', () => process.exit(0))
  const tick = async () => {
    if (inFlight) {
      process.stderr.write('[zzik-usage-collector] 이전 주기가 아직 진행 중이라 이번 주기를 건너뛴다\n')
      return
    }
    inFlight = true
    try {
      const intervalSec = storageConfig.intervalSec
      const { results } = await runCycle({maintenance}, buildProviders({ credentialsPath: null, provider: null, dryRun: false, once: false, codexAccountHeader: false }), { collectorVersion: VERSION, intervalSec })
      const failures = results.filter((result) => result.exitCode !== 0)
      if (failures.length > 0) {
        process.stderr.write(`[zzik-usage-collector] 주기 결과: ${failures.map((result) => `${result.id}=exit${result.exitCode}`).join(', ')}\n`)
      }
    } catch (error) {
      process.stderr.write('[zzik-usage-collector] 주기 실패: CycleError\n')
    } finally {
      inFlight = false
    }
  }
  void tick()
  setInterval(() => {
    void tick()
  }, storageConfig.intervalSec * 1000)
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error !== null || parsed.flags === null) {
    process.stderr.write(`오류: ${parsed.error}\n${USAGE_TEXT}\n`)
    process.exit(64)
    return
  }
  const configured = readStorageConfig(process.env, {dryRun:parsed.flags.dryRun})
  if (!configured.ok) {
    process.stderr.write('Storage configuration error: ' + configured.reason + '\n')
    process.exit(78)
    return
  }
  storageConfig = configured
  // Dry-run never creates a DB connection or a retention task.
  if (!parsed.flags.dryRun && configured.mode !== 'kv') {
    try {
      const client = postgres(/** @type {string} */ (process.env.DB_URL), {max:1,idle_timeout:5,connect_timeout:10,prepare:false,onnotice:()=>{}})
      database = client
      postgresWriter = createPostgresEnvelopeWriter({execute:(text,params)=>client.unsafe(text,params)})
      maintenance = {
        store: postgresWriter,
        state: createStateFile({path:join(STATE_DIR,'usage-prune.json')}),
        logger: createLogAppender({path:LOG_PATH}),
        retentionDays: configured.retentionDays,
      }
    } catch {
      process.stderr.write('Invalid database configuration\n')
      process.exit(78)
      return
    }
  }
  if (parsed.flags.once || parsed.flags.dryRun) {
    await once(parsed.flags)
    return
  }
  startResident()
}

await main()
