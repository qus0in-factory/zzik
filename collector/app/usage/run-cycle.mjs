import { shouldPrune } from '../../domain/usage/prune-schedule.mjs'
import { emptyCollectorState } from './run-once.mjs'
import { runOnce } from './run-once.mjs'

/** 실행 예외로 끝난 제공자의 종료 코드(4). 저장소 실패(3)보다 크고 정상(0)보다 크다. */
export const EXIT_RUN_FAILURE = 4

/** 주기 예산(ADR 0.3 v2): 한 주기(제공자 전체)의 상한 240초. */
export const CYCLE_BUDGET_MS = 240_000

/** 로그 전용 상태: 예산 초과로 제공자를 건너뛸 때(봉투·저장 없음). */
export const SKIPPED_BUDGET_STATUS = 'skipped_budget'

/**
 * 제공자 순회(ADR 0.3 D3). 순서대로(claude → codex) 한 제공자의 runOnce를 실행한다.
 * 각 실행을 예외 격리해서 하나가 던져도 다음 제공자를 실행한다.
 * 종료 코드는 제공자별 결과 중 가장 큰 값이다.
 *
 * @param {{ runOnce?: typeof runOnce, clock?: { now(): number }, maintenance?: {
 * state: import('../../domain/usage/ports.mjs').StateStorePort,
 * logger: import('../../domain/usage/ports.mjs').LoggerPort,
 * store: {prune(days:number):Promise<{ok:true,deleted:number}|{ok:false,message:string}>},
 * retentionDays?:number
 * } }} deps 시계는 주입(테스트)
 * @typedef {import('../../domain/usage/ports.mjs').CollectorPorts} CollectorPorts
 * @param {Array<{ id: string, ports: CollectorPorts, runOptions?: object }>} providers 런타임 계약 — ports는 조립 루트 계약, 배선 검증은 provider-bundles 테스트가 담당
 * @param {{ dryRun?: boolean, collectorVersion?: string, cycleBudgetMs?: number, intervalSec?: number }} options
 * @returns {Promise<{ results: Array<{ id: string, exitCode: number, skippedBudget?: boolean, dryRunReport?: object }>, exitCode: number }>}
 */
export async function runCycle(deps, providers = [], options = {}) {
  const run = deps.runOnce ?? runOnce
  const clock = deps.clock
  const budgetMs = options.cycleBudgetMs ?? CYCLE_BUDGET_MS
  const cycleStartMs = clock ? clock.now() : Date.now()
  /** @type {Array<{ id: string, exitCode: number, skippedBudget?: boolean, dryRunReport?: object }>} */
  const results = []
  for (const provider of providers) {
    // 시작 전 예산 확인(v2): 넘었으면 이번 주기에서 건너뛴다.
    const elapsed = (clock ? clock.now() : Date.now()) - cycleStartMs
    if (elapsed >= budgetMs) {
      try {
        await provider.ports.logger?.write({
          provider: provider.id,
          runAt: new Date((clock ? clock.now() : Date.now())).toISOString(),
          status: SKIPPED_BUDGET_STATUS,
          called: false,
          httpStatus: null,
          tokenExpiresAt: null,
          kvOk: false,
          kvReason: `주기 예산(240초) 초과로 건너뛴다(+${Math.round(elapsed / 1000)}초)`,
          transition: null,
          tokenRefreshed: false,
        })
      } catch {
        /* 로그마저 실패하면 제공자 순회를 막지 않는다 */
      }
      results.push({ id: provider.id, exitCode: 0, skippedBudget: true })
      continue
    }
    try {
      const result = await run(provider.ports, {
        ...options,
        provider: provider.id,
        ...(provider.runOptions ?? {}),
      })
      results.push({ id: provider.id, exitCode: result.exitCode, ...(result.dryRunReport !== undefined ? { dryRunReport: result.dryRunReport } : {}) })
    } catch (error) {
      try {
        await provider.ports.logger?.write({
          provider: provider.id,
          runAt: new Date(provider.ports.clock?.now?.() ?? Date.now()).toISOString(),
          status: 'cycle_error',
          called: false,
          httpStatus: null,
          tokenExpiresAt: null,
          kvOk: false,
          kvReason: 'CycleError',
          transition: null,
          tokenRefreshed: false,
        })
      } catch {
        /* 로그마저 실패하면 제공자 순회를 막지 않는다 */
      }
      results.push({ id: provider.id, exitCode: EXIT_RUN_FAILURE })
    }
  }
  if (!options.dryRun && deps.maintenance) {
    const maintenance = deps.maintenance
    try {
      const state = /** @type {import('../../domain/usage/ports.mjs').CollectorState|null} */ (await maintenance.state.read())
      const now = clock ? clock.now() : Date.now()
      if (shouldPrune(state?.lastPruneAt, now)) {
        const result = await maintenance.store.prune(maintenance.retentionDays ?? 30)
        if (result.ok) await maintenance.state.write({...emptyCollectorState(),...state,lastPruneAt:new Date(now).toISOString()})
        await maintenance.logger.write({
          provider:'storage',runAt:new Date(now).toISOString(),status:'prune',called:false,
          httpStatus:null,tokenExpiresAt:null,kvOk:result.ok,kvReason:result.ok ? 'deleted='+result.deleted : result.message,
          transition:null,tokenRefreshed:false,
        })
      }
    } catch { /* Retention is best effort and must not fail a provider cycle. */ }
  }
  const exitCode = results.reduce((max, result) => (result.exitCode > max ? result.exitCode : max), 0)
  return { results, exitCode }
}
