import { describe, expect, it } from 'vitest'
import type { Query } from '@tanstack/react-query'
import {
  describeGatewayFailure,
  shouldRetryUsage,
  usageQueryKey,
  usageQueryOptions,
  UsageLoadError,
  USAGE_ERROR_CODE_TEXT,
  USAGE_POLL_INTERVAL_MS,
  USAGE_QUERY_KEY_ROOT,
} from '@app/usage/usage-query'
import type { UsageGatewaySuccess } from '@domain/usage/gateway'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeUsageGateway } from '../../fakes/usage-ports'

const USAGE_SUCCESS = {
  ok: true,
  usage: normalRaw as Record<string, unknown>,
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
    const options = usageQueryOptions(gateway, 'claude')
    await expect((options.queryFn as unknown as () => Promise<UsageGatewaySuccess>)()).resolves.toEqual(USAGE_SUCCESS)
    expect(gateway.callsByProvider.claude).toBe(1)
  })

  it('When the provider is codex then the gateway is called with codex', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResultFor('codex', USAGE_SUCCESS)
    const options = usageQueryOptions(gateway, 'codex')
    await (options.queryFn as unknown as () => Promise<UsageGatewaySuccess>)()
    expect(gateway.callsByProvider.codex).toBe(1)
    expect(gateway.callsByProvider.claude).toBe(0)
  })

  it('When the gateway fails then ok:false is thrown as UsageLoadError', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResult({ ok: false, reason: 'session_expired', message: null })
    const options = usageQueryOptions(gateway, 'claude')
    await expect((options.queryFn as unknown as () => Promise<UsageGatewaySuccess>)()).rejects.toMatchObject({
      name: 'UsageLoadError',
      reason: 'session_expired',
    })
  })
})

describe('Given the query keys (D8)', () => {
  it('When building keys then each provider gets its own key under the usage prefix', () => {
    expect(USAGE_QUERY_KEY_ROOT).toEqual(['usage'])
    expect(usageQueryKey('claude')).toEqual(['usage', 'claude'])
    expect(usageQueryKey('codex')).toEqual(['usage', 'codex'])
    expect(usageQueryKey('claude')).not.toEqual(usageQueryKey('codex'))
  })

  it('When options are built for different providers then the keys never collide', () => {
    const gateway = createFakeUsageGateway()
    expect(usageQueryOptions(gateway, 'claude').queryKey).not.toEqual(usageQueryOptions(gateway, 'codex').queryKey)
  })
})

describe('Given the polling schedule', () => {
  function fakeQuery(error: unknown): Query<UsageGatewaySuccess, UsageLoadError> {
    return { state: { error } } as unknown as Query<UsageGatewaySuccess, UsageLoadError>
  }
  function intervalOf(gateway: ReturnType<typeof createFakeUsageGateway>) {
    return usageQueryOptions(gateway, 'claude').refetchInterval as (
      query: Query<UsageGatewaySuccess, UsageLoadError>,
    ) => number | false | undefined
  }

  it('When the last error is session_expired then polling stops (false)', () => {
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(new UsageLoadError('session_expired', null)))).toBe(false)
  })

  it('When the last error is api_error or there is no error then polling continues at 60s', () => {
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(new UsageLoadError('api_error', null)))).toBe(USAGE_POLL_INTERVAL_MS)
    expect(intervalOf(createFakeUsageGateway())(fakeQuery(null))).toBe(USAGE_POLL_INTERVAL_MS)
  })
})

describe('Given gateway failure texts (이슈 #17: 원시 코드 노출 금지)', () => {
  it.each([
    ['invalid_response', '응답 형식이 올바르지 않습니다'],
    ['snapshot_corrupt', '손상되었습니다'],
    ['storage_unavailable', '읽지 못했습니다'],
    ['jwks_unavailable', '로그인 확인 키'],
    ['misconfigured', '설정이 완료되지 않았습니다'],
    ['unauthorized', '로그인이 필요합니다'],
    ['not_found', '찾을 수 없습니다'],
    ['method_not_allowed', '지원하지 않는 요청'],
    ['invalid_query', '이력 요청 형식'],
    ['scan_version_mismatch', '새 버전이 배포되었습니다'],
    ['history_budget', '이력 요청이 너무 많아'],
  ] as const)('When the code is %s then the text is user facing', (code, snippet) => {
    const text = describeGatewayFailure('api_error', code)
    expect(text).toContain(snippet)
    expect(text).not.toContain(code)
  })

  it('When every mapped code renders then no raw code leaks through the error message', () => {
    for (const code of Object.keys(USAGE_ERROR_CODE_TEXT)) {
      const error = new UsageLoadError('api_error', code)
      expect(error.message).toBe(USAGE_ERROR_CODE_TEXT[code])
      expect(error.message).not.toBe(code)
    }
  })

  it.each([
    [502, '서버에서'],
    [503, '서버에서'],
    [404, '처리하지 못했습니다'],
  ] as const)('When the code is http_%s then it maps by status class', (status, snippet) => {
    expect(describeGatewayFailure('api_error', `http_${status}`)).toContain(snippet)
  })

  it('When the code is unknown but looks like a code then it falls back to the reason text', () => {
    expect(describeGatewayFailure('api_error', 'weird_code')).toBe('사용량을 불러오지 못했습니다.')
    expect(describeGatewayFailure('api_error', 'weird_code')).not.toContain('weird_code')
  })

  it('When the message is a human sentence then it is shown as is', () => {
    const message = '목 게이트웨이(error 시나리오): API 오류를 흉내 냅니다'
    expect(describeGatewayFailure('api_error', message)).toBe(message)
  })

  it('When there is no code then the reason decides the text', () => {
    expect(describeGatewayFailure('session_expired')).toContain('Access 세션')
    expect(describeGatewayFailure('network_error')).toContain('네트워크')
    expect(describeGatewayFailure('api_error')).toContain('불러오지 못했습니다')
  })

  it('When the load error is constructed then the message is already the user text', () => {
    expect(new UsageLoadError('api_error', 'invalid_response').message).toContain('응답 형식')
  })
})

describe('Given Neon Free scale-to-zero budgeting', () => {
  it('When polling usage Then waits fifteen minutes rather than waking the database every minute', () => {
    expect(USAGE_POLL_INTERVAL_MS).toBe(900_000)
  })
})


describe('Given a slow usage server', () => {
  it('When a request times out Then does not claim the device is offline', () => {
    expect(describeGatewayFailure('api_error', 'request_timeout')).toContain('응답 시간이 초과')
    expect(describeGatewayFailure('api_error', 'request_timeout')).not.toContain('네트워크')
  })
})
