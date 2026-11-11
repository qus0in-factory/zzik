import { runOnce } from './run-once.mjs'

/** 실행 예외로 끝난 제공자의 종료 코드(4). KV 실패(3)보다 크고 정상(0)보다 크다. */
export const EXIT_RUN_FAILURE = 4

/**
 * 제공자 순회(ADR 0.3 D3). 순서대로(claude → codex) 한 제공자의 runOnce를 실행한다.
 * 각 실행을 예외 격리해서 하나가 던져도 다음 제공자를 실행한다.
 * 종료 코드는 제공자별 결과 중 가장 큰 값이다.
 *
 * @param {{ runOnce?: typeof runOnce }} deps
 * @typedef {import('../../domain/usage/ports.mjs').CollectorPorts} CollectorPorts
 * @param {Array<{ id: string, ports: CollectorPorts }>} providers 조립 루트가 만든 제공자별 포트 묶음
 * @param {{ dryRun?: boolean, collectorVersion?: string }} options
 * @returns {Promise<{ results: Array<{ id: string, exitCode: number, dryRunReport?: object }>, exitCode: number }>}
 */
export async function runCycle(deps, providers, options = {}) {
  const run = deps.runOnce ?? runOnce
  /** @type {Array<{ id: string, exitCode: number, dryRunReport?: object }>} */
  const results = []
  for (const provider of providers) {
    try {
      const result = await run(provider.ports, { ...options, provider: provider.id })
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
          kvReason: `실행 예외: ${String(error)}`,
          transition: null,
          tokenRefreshed: false,
        })
      } catch {
        /* 로그마저 실패하면 제공자 순회를 막지 않는다 */
      }
      results.push({ id: provider.id, exitCode: EXIT_RUN_FAILURE })
    }
  }
  const exitCode = results.reduce((max, result) => (result.exitCode > max ? result.exitCode : max), 0)
  return { results, exitCode }
}
