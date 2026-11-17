#!/usr/bin/env node
/**
 * 수집기 조립 루트(ADR 0.3 D3 다중 제공자 + D9 조립 배정).
 * 제공자 정의(claude/codex/antigravity/opencode/grok/ollama)를 만들어 runCycle에 주입한다. 로직은 이 파일에 두지 않는다.
 *
 * 실행 모드(PM2 상주가 기본):
 *   (기본)       provider별 nextDue에 따라 D1 resident가 수집한다
 *   --once       1회 실행 후 종료한다. 종료 코드는 제공자별 결과 중 가장 큰 값
 *   --dry-run    상태·DB·로그 어디에도 쓰지 않는다(--provider와 같이 쓰면 경로 목록 출력)
 *   --provider <id>   대상 제공자(claude|codex|antigravity|opencode|grok|ollama). 생략하면 켜진 제공자 전부
 *   --credentials-file <path>  자격 증명 파일 재현(--provider와 --dry-run이 함께 있을 때만)
 *
 * 제공자 목록: env ZZIK_PROVIDERS(기본 전체 6개). 하나의 제공자 실패가 다른
 * 제공자를 막지 않는다(예외 격리, 제공자별 상태 파일·게이트).
 *
 * D1 단독이며 기본 실행은 ledger/sender를 조립한다.
 * D1 자격은 Node --env-file로 주입하며,
 * 원격 쓰기는 공용 D1 REST query lane에서 직렬 전송한다.
 */

import {OFFPEAK_SCHEDULE} from '../shared/offpeak-schedule.ts'
import {formatOffpeakMessage} from './domain/usage/offpeak-notification.mjs'
import {createOffpeakScheduler} from './app/usage/offpeak-scheduler.mjs'
import {createOffpeakRuntime} from './app/usage/offpeak-runtime.mjs'
import {createOffpeakState} from './infra/usage/offpeak-state.mjs'
import {resumeQuarantinedProvider} from './app/usage/resume-quarantine.mjs'
import {randomUUID} from 'node:crypto'
import {openSqliteLedger} from './infra/usage/sqlite-ledger.mjs'
import {createD1ControlFile} from './infra/usage/d1-control-file.mjs'
import {createWranglerOAuthCredentials} from './app/usage/d1-oauth-credentials.mjs'
import {createWranglerOAuthFile,defaultWranglerOAuthPath} from './infra/usage/wrangler-oauth-file.mjs'
import {createWranglerOAuthRefresh} from './infra/usage/wrangler-oauth-refresh.mjs'
import {createD1RestClient} from './infra/usage/d1-rest-client.mjs'
import {createCollectorNotice} from './infra/usage/collector-notice.mjs'
import {readLegacyLedgerInputs,reconcileD1Startup} from './app/usage/d1-startup.mjs'
import {createD1Resident} from './app/usage/d1-resident.mjs'
import {createStartupGate} from './app/usage/startup-quiesce.mjs'
import { readAlertConfig } from './domain/usage/alert-config.mjs'
import { createDiscordAlerts } from './infra/usage/discord-alerts.mjs'
import { readIntervalCapability } from './infra/usage/interval-capability.mjs'
import { readStorageConfig } from './domain/usage/storage-config.mjs'
import { createLogAppender } from './infra/usage/log.mjs'
import { createUsageClient as createClaudeUsageClient } from './infra/usage/claude-usage-client.mjs'
import { createAntigravityCliUsageClient } from './infra/usage/antigravity-cli-usage-client.mjs'
import { createGrokUsageClient } from './infra/usage/grok-usage-client.mjs'
import { readGrokBuildCredentials } from './infra/usage/grok-build-credentials-file.mjs'
import { createOpencodeUsageClient } from './infra/usage/opencode-usage-client.mjs'
import { createOllamaUsageClient, DEFAULT_OLLAMA_HOST, isAllowedOllamaHost } from './infra/usage/ollama-usage-client.mjs'
import { readOllamaLocalCredentials } from './infra/usage/ollama-local-credentials.mjs'
import { createOpencodeDbCredentialReader, DEFAULT_OPENCODE_DB_PATH } from './infra/usage/opencode-db-credentials.mjs'
import { runAgyQuotaCli } from './infra/usage/agy-quota-cli-runner.mjs'
import { createCodexUsageClient } from './infra/usage/codex-usage-client.mjs'
import { createStateFile } from './infra/usage/state-file.mjs'
import { DEFAULT_CREDENTIALS_PATH, readCredentialsFile } from './infra/usage/claude-credentials-file.mjs'
import { DEFAULT_CODEX_AUTH_PATH, readCodexCredentials } from './infra/usage/codex-credentials-file.mjs'
import { createResidentCollector } from './app/usage/resident-collector.mjs'
import { createCollectorTimer } from './infra/usage/collector-timer.mjs'
import { runCycle } from './app/usage/run-cycle.mjs'
import { buildProviderBundles } from './app/usage/provider-bundles.mjs'
import { USAGE_COLLECTOR_VERSION, USAGE_REDACTION_PATHS, USAGE_PROVIDERS as PROVIDER_IDS, parseProvidersEnv } from './domain/usage/providers.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const alertConfig = readAlertConfig(process.env)
const alerts = createDiscordAlerts({ ...alertConfig, fetchImpl:globalThis.fetch, log:line => process.stdout.write(`${line}\n`) })
const VERSION = USAGE_COLLECTOR_VERSION
/** @type {{mode:'d1',intervalSec:number,retentionDays:number,intervals?:Record<string,number>,oauthProfile?:string}} */
let storageConfig = {mode:'d1',intervalSec:900,retentionDays:30}
const STATE_DIR = process.env.ZZIK_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'zzik')
const LOG_PATH = process.env.ZZIK_LOG_PATH ?? join(homedir(), 'Library', 'Logs', 'zzik', 'usage-collector.log')

/** @param {string} value @returns {string} */
function resolveHomePath(value) {
  if (value.startsWith('~')) return join(homedir(), value.slice(1))
  return value
}

const OPENCODE_DB_PATH = process.env.ZZIK_OPENCODE_DB_PATH ? resolveHomePath(process.env.ZZIK_OPENCODE_DB_PATH) : DEFAULT_OPENCODE_DB_PATH
const OLLAMA_HOST = process.env.ZZIK_OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST
if (!isAllowedOllamaHost(OLLAMA_HOST)) {
  process.stderr.write('Invalid Ollama host (loopback http만 허용)\n')
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
  process.stderr.write('[zzik-usage-collector] ZZIK_PROVIDERS 해석 결과가 비었다. claude,codex,antigravity,opencode,grok,ollama 형식으로 설정한다\n')
  process.exit(78)
}

const USAGE_TEXT = '격리 재개: ZZIK_STORE=d1 node collector/main.mjs --resume-without-quarantine <provider> (기동 전 운영자 명령)\n사용법: node collector/main.mjs [--once] [--dry-run] [--provider claude|codex|antigravity|opencode|grok|ollama] [--credentials-file <path>]'

/** @typedef {import('./domain/usage/ports.mjs').CollectorPorts} CollectorPorts */
/** @typedef {{ dryRun: boolean, once: boolean, credentialsPath: string|null, provider: string|null, codexAccountHeader: boolean, resumeWithoutQuarantine:string|null }} ParsedFlags */

/**
 * @param {string[]} argv
 * @returns {{ error: string|null, flags: ParsedFlags | null }}
 */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean, once: boolean, credentialsPath: string|null, provider: string|null, codexAccountHeader: boolean, resumeWithoutQuarantine:string|null }} */
  const flags = { dryRun: false, once: false, credentialsPath: null, provider: null, codexAccountHeader: false, resumeWithoutQuarantine:null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--codex-account-header') flags.codexAccountHeader = true
    else if (arg === '--once') flags.once = true
    else if(arg==='--resume-without-quarantine'){
      const value=argv[++index]
      if(!PROVIDER_IDS.includes(value))return {error:'InvalidResumeProvider',flags:null}
      flags.resumeWithoutQuarantine=value
    }
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
  if(flags.resumeWithoutQuarantine!==null&&(flags.dryRun||flags.once||flags.provider!==null||flags.credentialsPath!==null))return {error:'ResumeCommandMustBeStandalone',flags:null}
  if (flags.credentialsPath !== null && (flags.dryRun !== true || flags.provider === null)) {
    return { error: '--credentials-file은 --provider와 --dry-run이 함께 있을 때만 쓴다(시험 자격 증명으로 다른 제공자의 저장소에 쓰는 일을 막는다)', flags: null }
  }
  if (flags.codexAccountHeader === true && flags.dryRun !== true) {
    return { error: '--codex-account-header는 --dry-run과 함께만 쓴다(G2 진단용)', flags: null }
  }
  return { error: null, flags }
}

/**
 * 제공자 하나의 포트 묶음(ADR 0.3 D3의 표). 자격 증명 포트·usage 포트·상태 파일이
 * 제공자별로 다르고 나머지(시계, 로거, D1 ledger)는 공유한다.
 * @param {string} provider
 * @param {{ credentialsPath: string|null, dryRun: boolean }} options
 * @returns {CollectorPorts}
 */
function buildProviderPorts(provider, { credentialsPath, dryRun }) {
  const usageClient =
    provider === 'grok'
      ? createGrokUsageClient({ fetchImpl: globalThis.fetch })
      : provider === 'opencode'
      ? createOpencodeUsageClient({ fetchImpl: globalThis.fetch })
      : provider === 'ollama'
      ? createOllamaUsageClient({ fetchImpl: globalThis.fetch, host: OLLAMA_HOST })
      : provider === 'antigravity'
      ? createAntigravityCliUsageClient({ runQuota: () => runAgyQuotaCli({ path: process.env.ZZIK_AGY_CLI_PATH ?? 'agy', enabled: process.env.ZZIK_AGY_CLI_ENABLED !== '0' }) })
      : provider === 'codex'
      ? createCodexUsageClient({ fetchImpl: globalThis.fetch })
      : createClaudeUsageClient({ fetchImpl: globalThis.fetch })
  /** @param {string} message @returns {void} */
  const warn = (message) => {
    process.stderr.write(`[zzik-usage-collector] warn: ${message}\n`)
  }
  const readOpencodeDb = (/** @type {string} */ integrationId) => createOpencodeDbCredentialReader({ path: credentialsPath ?? OPENCODE_DB_PATH, integrationId, warn })()
  return {
    clock: { now: () => Date.now() },
    credentials: {
      readAll: async () => {
        if (provider === 'grok') return [await readGrokBuildCredentials(credentialsPath ?? undefined)]
        if (provider === 'opencode') return [await readOpencodeDb('opencode')]
        if (provider === 'ollama') return [await readOllamaLocalCredentials()]
        if (provider === 'antigravity') return [dryRun ? null : { source: 'cli', token: '', expiresAt: null, accountId: null }]
        if (provider === 'codex') return [await readCodexCredentials(credentialsPath ?? CODEX_AUTH_PATH, { warn })]
        return [await readCredentialsFile(credentialsPath ?? DEFAULT_CREDENTIALS_PATH)]
      },
    },
    usage: { fetchUsage: (token, opts) => usageClient.fetchUsage(token, opts) },
    // Dry-run never invokes this port and must not construct a DB connection.
    store: { write: async () => ({ ok: false, httpStatus: null, message: 'DatabaseNotInitialized' }) },
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
    buildPorts: (providerId) => buildProviderPorts(providerId, { credentialsPath: flags.credentialsPath, dryRun: flags.dryRun }),
  })
}

/** @param {ParsedFlags} flags @returns {Promise<void>} */
async function once(flags) {
  const intervalSec = storageConfig.intervalSec
  /** @type {Awaited<ReturnType<typeof runCycle>>} */let completed={results:[],exitCode:0}
  const runner=createResidentCollector({periodMs:intervalSec*1000,timer:createCollectorTimer(),
    run:async shouldStop=>{completed=await runCycle({alerts},buildProviders(flags),{dryRun:flags.dryRun,collectorVersion:VERSION,intervalSec,shouldStop})},
    close:async()=>{},
    onError:()=>{completed={results:[{id:'collector',exitCode:4}],exitCode:4}},
  })
  bindShutdown(runner)
  await runner.runOnce()
  const {results}=completed
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
  await runner.shutdown()
  process.exit(Math.max(0, ...results.map((result) => result.exitCode)))
}

/** @param {{shutdown():Promise<{timedOut:boolean}>}} runner */
function bindShutdown(runner){
 const shutdown=()=>{void runner.shutdown().then(result=>{process.stderr.write(`[zzik-usage-collector] shutdown=${result.timedOut?'timeout':'complete'}\n`);process.exit(0)})}
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
}

/** @param {ParsedFlags} flags */
async function startD1(flags){
  const providers=buildProviders(flags)
  const imported=await readLegacyLedgerInputs(providers,createStateFile({path:join(STATE_DIR,'usage-prune.json')}))
  const opened=openSqliteLedger({directory:STATE_DIR,nowMs:Date.now(),...imported})
  if(!opened.ok){process.stderr.write('D1 ledger startup error: '+opened.reason+'\n');process.exit(78);return}
  const ledger=opened.value,clock={now:()=>Date.now()},control=createD1ControlFile({path:join(STATE_DIR,'d1-sender-control.json')})
  const notice=createCollectorNotice({...readAlertConfig(process.env),fetchImpl:globalThis.fetch,log:line=>process.stderr.write(line+'\n')})
  /** @type {ReturnType<typeof createD1Resident>|null} */let activeRuntime=null
  /** @type {ReturnType<typeof createOffpeakRuntime>} */let offpeak=null
  /** @type {()=>boolean} */let startupStopped=()=>false
  const credentials=process.env.ZZIK_D1_AUTH==='wrangler-oauth'?createWranglerOAuthCredentials({file:createWranglerOAuthFile({path:defaultWranglerOAuthPath(storageConfig.oauthProfile)}),refresh:createWranglerOAuthRefresh({profile:storageConfig.oauthProfile}),clock}):undefined
  const query=createD1RestClient({credentials,mode:'d1',dryRun:false,control,clock,canRequest:()=>!startupStopped()&&(activeRuntime?.canRequest()??true),
    accountId:/** @type {string} */(process.env.ZZIK_D1_ACCOUNT_ID),databaseId:/** @type {string} */(process.env.ZZIK_D1_DATABASE_ID),token:credentials?undefined:process.env.ZZIK_D1_API_TOKEN,
    fetch:globalThis.fetch,wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  })
  const notifyAlerts=async(/** @type {unknown[]} */events)=>{await alerts.send(/** @type {import('./domain/usage/alert-types.mjs').AlertEvent[]} */(events))}
  const gate=createStartupGate({timer:createCollectorTimer(),
    reconcile:stop=>{startupStopped=stop;return reconcileD1Startup({ledger,query,clock,providers:providers.map(bundle=>/** @type {import('../shared/usage-contract.ts').UsageProvider} */(bundle.id)),notifyAlerts})},
    closeStartup:async()=>{ledger.close()},
    onReady:()=>{activeRuntime=createD1Resident({ledger,control,query,clock,notice,notifyAlerts,timer:createCollectorTimer(),random:Math.random,operationId:randomUUID,providers,intervals:storageConfig.intervals??{},retentionDays:storageConfig.retentionDays,collectorVersion:VERSION,once:flags.once,shutdownPending:()=>offpeak?[offpeak.stop()]:[]});return activeRuntime},
  })
  bindShutdown({shutdown:()=>offpeak?offpeak.shutdownWith(gate,createCollectorTimer()):gate.shutdown()})
  const reconciled=/** @type {Awaited<ReturnType<typeof reconcileD1Startup>>} */(await gate.start())
  if(gate.stopping())return
  if(!reconciled.ok){ledger.close();process.stderr.write('D1 reconciliation error: '+reconciled.reason+'\n');process.exit(78);return}
  const active=/** @type {ReturnType<typeof createD1Resident>} */(gate.activate())
  if(flags.resumeWithoutQuarantine!==null){
    const result=await resumeQuarantinedProvider({mode:'d1',provider:/** @type {import('../shared/usage-contract.ts').UsageProvider} */(flags.resumeWithoutQuarantine),ledger,query,resume:(provider,facts)=>active.resumeWithoutQuarantine(provider,facts)})
    process.stdout.write(JSON.stringify({ok:result.ok,...(!result.ok?{reason:result.reason}:{})})+'\n')
    await active.shutdown();process.exit(result.ok?0:3);return
  }
  active.start()
  offpeak=createOffpeakRuntime({once:flags.once,dryRun:flags.dryRun,resume:flags.resumeWithoutQuarantine!==null,enabled:process.env.ZZIK_OFFPEAK_NOTIFY!=='0'&&alertConfig.enabled,webhook:!!alertConfig.webhookUrl,create:()=>createOffpeakScheduler({schedule:OFFPEAK_SCHEDULE,clock,timer:createCollectorTimer(),state:createOffpeakState({path:join(STATE_DIR,'offpeak-notify.json')}),send:events=>alerts.sendMessage(formatOffpeakMessage(events),events.length),log:reason=>process.stderr.write(`[zzik-offpeak] ${reason}\n`)})})
  if(offpeak)void offpeak.start()
  if(flags.once){while(!active.onceDone())await new Promise(resolve=>setTimeout(resolve,100));const code=active.exitCode();await active.shutdown();process.exit(code)}
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error !== null || parsed.flags === null) {
    process.stderr.write(`오류: ${parsed.error}\n${USAGE_TEXT}\n`)
    process.exit(64)
    return
  }
  const configured = readStorageConfig(process.env, {dryRun:parsed.flags.dryRun,capability:readIntervalCapability(join(STATE_DIR,'interval-capability.json'))})
  if (!configured.ok) {
    process.stderr.write('Storage configuration error: ' + configured.reason + '\n')
    process.exit(78)
    return
  }
  storageConfig = configured
  if (parsed.flags.dryRun) {await once(parsed.flags);return}
  await startD1(parsed.flags)
}

await main()
