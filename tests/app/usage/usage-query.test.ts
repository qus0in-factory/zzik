import { describe, expect, it } from 'vitest'
import type { Query } from '@tanstack/react-query'
import { describeGatewayFailure, usageQueryKey, usageQueryOptions, UsageLoadError, shouldRetryUsage, USAGE_POLL_INTERVAL_MS } from '@app/usage/usage-query'
import type { UsageGatewaySuccess } from '@domain/usage/gateway'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeUsageGateway } from '../../fakes/usage-ports'
import type { RawUsage } from '@domain/usage/types'

const USAGE_SUCCESS = {
  ok: true,
  usage: normalRaw as RawUsage,
  collection: null,
  rawText: null,
} as const

describe('Given the query retry policy', () => {
  it.each([
    ['network_error', 0, true],
    ['network_error', 1, true],
    ['network_error', 2, false],
    ['api_error', 0, false],
    ['session_expired', 0, false],
  ] as const)('When the reason is %s at attempt %s then retrying is %s', (reason, failureCount, expected) => {
    expect(shouldRetryUsage(failureCount, new UsageLoadError(reason, null))).toBe(expected)
  })

  it('When the error is not a usage load error then it is not retried', () => {
    expect(shouldRetryUsage(0, new Error('unexpected'))).toBe(false)
    expect(shouldRetryUsage(0, null)).toBe(false)
  })
})

describe('Given the usage queryFn', () => {
  it('When the gateway succeeds then the raw success result is cached', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResult(USAGE_SUCCESS)
    const options = usageQueryOptions(gateway)
    await expect((options.queryFn as unknown as () => Promise<UsageGatewaySuccess>)()).resolves.toEqual(USAGE_SUCCESS)
  })

  it('When the gateway fails then ok:false is thrown as UsageLoadError', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResult({ ok: false, reason: 'session_expired', message: null })
    const options = usageQueryOptions(gateway)
    await expect((options.queryFn as unknown as () => Promise<UsageGatewaySuccess>)()).rejects.toMatchObject({
      name: 'UsageLoadError',
      reason: 'session_expired',
    })
  })
})

describe('Given the polling schedule', () => {
  function fakeQuery(error: unknown): Query<UsageGatewaySuccess, UsageLoadError> {
    return { state: { error } } as unknown as Query<UsageGatewaySuccess, UsageLoadError>
  }
  function intervalOf(gateway: ReturnType<typeof createFakeUsageGateway>): (query: Query<UsageGatewaySuccess, UsageLoadError>) => number | false | undefined {
    return usageQueryOptions(gateway).refetchInterval as (query: Query<UsageGatewaySuccess, UsageLoadError>) => number | false | undefined
  }

  it('When the last error is session_expired then polling stops (false)', () => {
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(new UsageLoadError('session_expired', null)))).toBe(false)
  })

  it('When the last error is api_error or there is no error then polling continues at 60s', () => {
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(new UsageLoadError('api_error', null)))).toBe(USAGE_POLL_INTERVAL_MS)
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(null))).toBe(USAGE_POLL_INTERVAL_MS)
  })

  it('When the query key is fixed then it never drifts', () => {
    expect(usageQueryKey).toEqual(['usage', 'claude'])
  })
})

describe('Given gateway failure texts', () => {
  it('When the reason has no message then the default text is used', () => {
    expect(describeGatewayFailure('session_expired')).toContain('Access 세션')
    expect(describeGatewayFailure('network_error')).toContain('네트워크')
    expect(describeGatewayFailure('api_error')).toContain('불러오지 못했습니다')
  })

  it('When the raw fixture data is normal then the query options stay stable across builds', () => {
    // queryOptions가 매번 캐시 키·옵션을 동일하게 만드는지(불변식) 확인한다.
    const first = usageQueryOptions(createFakeUsageGateway())
    const second = usageQueryOptions(createFakeUsageGateway())
    expect(first.queryKey).toEqual(second.queryKey)
    expect(first.staleTime).toBe(second.staleTime)
  })
})
