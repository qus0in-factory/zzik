import { describe, expect, it } from 'vitest'
import { loadUsage } from '@app/usage/load-usage'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeUsageGateway, NOW } from '../../fakes/usage-ports'

describe('Given the usage loader', () => {
  it('When the gateway returns usage then it is built into a report', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResult({ ok: true, usage: normalRaw })
    const result = await loadUsage(gateway, { now: NOW })
    expect(result).toEqual({
      ok: true,
      report: expect.objectContaining({ status: 'normal', windows: expect.any(Array), metrics: expect.any(Array) }),
    })
    if (result.ok) {
      expect(result.report.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 37 })
    }
  })

  it('When the gateway fails then the reason and message pass through unchanged', async () => {
    for (const reason of ['session_expired', 'api_error', 'network_error'] as const) {
      const gateway = createFakeUsageGateway()
      gateway.pushResult({ ok: false, reason, message: reason === 'api_error' ? '서버 오류' : null })
      const result = await loadUsage(gateway, { now: NOW })
      expect(result).toEqual({ ok: false, reason, message: reason === 'api_error' ? '서버 오류' : null })
    }
  })
})
