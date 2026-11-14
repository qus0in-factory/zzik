/**
 * 수집기 포트의 JSDoc typedef(ADR 0.2 D11). 구현은 infra, 주입은 조립 루트가 한다.
 * 봉투 계약은 shared/usage-contract.js에서 온다.
 */

/**
 * @typedef {import('../../../shared/usage-contract.js').UsageEnvelope} UsageEnvelope
 * @typedef {import('../../../shared/usage-contract.js').UsageStatus} UsageStatus
 */

/**
 * @typedef {{ source: string, token: string, expiresAt: number|null, accountId?: string|null }} CredentialRead
 * 한 번의 자격 증명 읽기. 실패한 읽기는 목록에 null로 들어온다.
 */

/**
 * @typedef {{ ok: true, bodyText: string, httpStatus: number|null, retryAfterSec: number|null }} UsageCallOk
 * @typedef {{ ok: false, kind: 'rate_limited'|'auth_required'|'auth_rejected'|'upstream_error'|'network_error', httpStatus: number|null, retryAfterSec: number|null, diag?: string }} UsageCallFailure
 * @typedef {UsageCallOk|UsageCallFailure} UsageCallResult
 * retryAfterSec는 초 단위(D5).
 */

/** @typedef {{ ok: true } | { ok: false, httpStatus: number|null, message: string }} StoreWriteResult */

/**
 * @typedef {{ nextAllowedAt: number|null, failReason: string|null, failCount: number, authFailCount: number, authDeniedExpiresAt: number|null }} GateState
 * @typedef {{ provider: string|null, schema: number, previous: UsageEnvelope|null, lastEventAt?:string|null, gate: GateState, lastPruneAt?:string|null, lastRun: { status: string|null, tokenExpiresAt: number|null } }} CollectorState
 * kvOk/kvReason는 운영 로그 호환 이름이며 현재 Postgres 저장 결과를 뜻한다.
 * @typedef {{ provider: string, runAt: string, status: string, called: boolean, httpStatus: number|null, tokenExpiresAt: string|null, kvOk: boolean, kvReason: string|null, transition: string|null, tokenRefreshed: boolean, diag?: string|null, source?: string|null }} LogEntry
 */

/** @typedef {{ now(): number }} ClockPort */
/** @typedef {{ readAll(): Promise<Array<CredentialRead|null>>, warn?: (message: string) => void }} CredentialReaderPort */
/** @typedef {{ fetchUsage(token: string, options?: { accountId?: string|null }): Promise<UsageCallResult> }} UsageClientPort */
/** @typedef {{ provider:string, status:string, runAt:string, fetchedAt:string|null, rawSha256:string|null, collectorVersion:string, changed:boolean, heartbeat?:boolean }} StoreMeta
 * @typedef {{ write(value: string, meta: StoreMeta): Promise<StoreWriteResult> }} StoreWriterPort */
/** @typedef {{ read(): Promise<unknown>, write(state: unknown): Promise<void> }} StateStorePort */
/** @typedef {{ write(entry: LogEntry): Promise<void> }} LoggerPort */

/**
 * @typedef {{
 *   clock: ClockPort,
 *   credentials: CredentialReaderPort,
 *   usage: UsageClientPort,
 *   store: StoreWriterPort,
 *   state: StateStorePort,
 *   logger: LoggerPort,
 * }} CollectorPorts
 */
