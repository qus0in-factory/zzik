/**
 * 수집기 포트의 JSDoc typedef(ADR 0.2 D11). 구현은 infra, 주입은 조립 루트가 한다.
 * 봉투 계약은 shared/usage-contract.js에서 온다.
 */

/**
 * @typedef {import('../../../shared/usage-contract.js').UsageEnvelope} UsageEnvelope
 * @typedef {import('../../../shared/usage-contract.js').UsageStatus} UsageStatus
 */

/**
 * @typedef {{ source: string, token: string, expiresAt: number|null }} CredentialRead
 * 한 번의 자격 증명 읽기. 실패한 읽기는 목록에 null로 들어온다.
 */

/**
 * @typedef {{ ok: true, bodyText: string, httpStatus: number, retryAfterSec: null }} UsageCallOk
 * @typedef {{ ok: false, kind: 'rate_limited'|'auth_required'|'upstream_error'|'network_error', httpStatus: number|null, retryAfterSec: number|null }} UsageCallFailure
 * @typedef {UsageCallOk|UsageCallFailure} UsageCallResult
 * retryAfterSec는 초 단위(D5).
 */

/** @typedef {{ ok: true } | { ok: false, httpStatus: number|null, message: string }} KvWriteResult */

/**
 * @typedef {{ nextAllowedAt: number|null, failReason: string|null, failCount: number, authDeniedExpiresAt: number|null }} GateState
 * @typedef {{ schema: number, previous: UsageEnvelope|null, gate: GateState, lastRun: { status: string|null, tokenExpiresAt: number|null } }} CollectorState
 * @typedef {{ runAt: string, status: string, called: boolean, httpStatus: number|null, tokenExpiresAt: string|null, kvOk: boolean, kvReason: string|null, transition: string|null, tokenRefreshed: boolean }} LogEntry
 */

/** @typedef {{ now(): number }} ClockPort */
/** @typedef {{ readAll(): Promise<Array<CredentialRead|null>> }} CredentialReaderPort */
/** @typedef {{ fetchUsage(token: string): Promise<UsageCallResult> }} UsageClientPort */
/** @typedef {{ write(value: string): Promise<KvWriteResult> }} KvWriterPort */
/** @typedef {{ read(): Promise<CollectorState|null>, write(state: CollectorState): Promise<void> }} StateStorePort */
/** @typedef {{ write(entry: LogEntry): Promise<void> }} LoggerPort */

/**
 * @typedef {{
 *   clock: ClockPort,
 *   credentials: CredentialReaderPort,
 *   usage: UsageClientPort,
 *   kv: KvWriterPort,
 *   state: StateStorePort,
 *   logger: LoggerPort,
 * }} CollectorPorts
 */
