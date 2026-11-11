import { describe, expect, it } from 'vitest'
import { composeCollectionNote } from '@app/usage/usage-text'
import type { UsageCollectionStatus } from '@app/usage/load-usage'

const META = { httpStatus: 401, retryAt: null }

describe('Given the collection status note (ADR 0.3 v2 D4 안내 표)', () => {
  it.each([
    ['token_expired', 'Codex를 실행하면 갱신됩니다'],
    ['auth_required', '인증 상태를 확인할 수 없습니다'],
    ['no_credentials', '자격 증명을 찾지 못했습니다'],
    ['network_error', '네트워크 오류'],
    ['collector_down', '수집기가 응답하지 않습니다'],
    ['stale', '오래되었습니다'],
  ] as const)('When the status is %s then the note explains it', (status, snippet) => {
    expect(composeCollectionNote('codex', status, META)).toContain(snippet)
  })

  it('When the token expired then the note names the provider client to run', () => {
    expect(composeCollectionNote('claude', 'token_expired', META)).toContain('Claude Code')
    expect(composeCollectionNote('codex', 'token_expired', META)).toContain('Codex')
  })

  it('When the server rejected a valid token then the note is distinct from token_expired (v2 H2)', () => {
    const rejected = composeCollectionNote('codex', 'auth_rejected', { httpStatus: 401, retryAt: null })
    const expired = composeCollectionNote('codex', 'token_expired', { httpStatus: null, retryAt: null })
    expect(rejected).not.toBe(expired)
    expect(rejected).toContain('서버가')
    expect(rejected).toContain('다시 로그인')
    expect(rejected).toContain('로그의 상태 코드')
  })

  it('When the upstream answered a non-JSON 403 then the note says it was blocked, not a login problem', () => {
    const blocked = composeCollectionNote('codex', 'upstream_error', { httpStatus: 403, retryAt: null })
    expect(blocked).toContain('차단')
    expect(blocked).toContain('403')
    expect(blocked).not.toContain('로그인')
  })

  it('When upstream failed with another status then the last status code is shown', () => {
    expect(composeCollectionNote('claude', 'upstream_error', { httpStatus: 503, retryAt: null })).toContain('HTTP 503')
  })

  it('When upstream failed without a status code then the note does not invent one', () => {
    const note = composeCollectionNote('claude', 'upstream_error', { httpStatus: null, retryAt: null })
    expect(note).toContain('수집 중 오류')
    expect(note).not.toContain('HTTP')
    expect(note).not.toContain('null')
  })

  it('When rate limited then the note uses the retry time when it exists', () => {
    expect(composeCollectionNote('claude', 'rate_limited', { httpStatus: null, retryAt: '2026-11-11T12:30:00.000Z' })).toContain('이후')
    expect(composeCollectionNote('claude', 'rate_limited', { httpStatus: null, retryAt: null })).toContain('다음 주기')
  })
})

describe('Given a healthy or unknown collection status', () => {
  it('When the collection is healthy then there is no note', () => {
    expect(composeCollectionNote('claude', 'ok', { httpStatus: 200, retryAt: null })).toBeNull()
  })

  it('When there is no envelope at all (목 데이터) then there is no note', () => {
    const statuses: Array<UsageCollectionStatus | null> = [null]
    for (const status of statuses) expect(composeCollectionNote('claude', status, null)).toBeNull()
  })
})
