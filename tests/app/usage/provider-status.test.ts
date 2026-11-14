import { describe, expect, it } from 'vitest'
import { providerStatusOf } from '@app/usage/provider-status'
import type { UsageCollectionStatus } from '@app/usage/load-usage'
import type { UsageUiStatus } from '@app/usage/useUsage'
import type { UsageLevel } from '@domain/usage/types'

const LAST = '마지막 수집 10:09 (2분 전)'

const status = (input: { status: UsageUiStatus; reportStatus?: UsageLevel | null; collectionStatus?: UsageCollectionStatus | null; issueCount?: number; lastSuccessText?: string | null }) =>
  providerStatusOf({ reportStatus: 'normal', collectionStatus: null, issueCount: 0, lastSuccessText: null, ...input })

describe('Given the provider connection light (연결·수집 상태만; 사용량 수준과 무관)', () => {
  describe('초록: 수집 정상', () => {
    it.each([
      ['봉투 없음(목)', null],
      ['수집 ok', 'ok'],
    ] as const)('When ready with %s Then green', (_name, collectionStatus) => {
      expect(status({ status: 'ready', collectionStatus })).toMatchObject({ level: 'ok', label: '정상' })
    })
    it.each(['normal', 'warn', 'limit'] as const)('When the usage level is %s Then still green (한도 도달도 연결은 정상)', (reportStatus) => {
      expect(status({ status: 'ready', reportStatus, collectionStatus: 'ok' }).level).toBe('ok')
    })
  })

  describe('빨강: 수집기 상태가 정상·stale·collector_down이 아닌 모든 실패(이전 데이터가 있어도)', () => {
    it.each([
      ['rate_limited', '요청 제한'],
      ['token_expired', '토큰 만료'],
      ['auth_required', '인증 필요'],
      ['auth_rejected', '인증 거부'],
      ['no_credentials', '자격 증명 없음'],
      ['upstream_error', '상류 오류'],
      ['network_error', '네트워크 오류'],
    ] as const)('When stale data exists but the collector reports %s Then red with the reason %s', (collectionStatus, reason) => {
      expect(status({ status: 'stale', collectionStatus, lastSuccessText: LAST })).toMatchObject({
        level: 'danger',
        label: `수집 실패 · ${reason}`,
        description: `수집 실패 · ${reason} · ${LAST}`,
      })
    })
    it('When there is no data and the request errored Then red', () => {
      expect(status({ status: 'error', reportStatus: null })).toMatchObject({ level: 'danger', label: '오류' })
    })
  })

  describe('노랑: 오래된 데이터·collector_down·부분 실패', () => {
    it.each([
      ['stale', '오래된 데이터'],
      ['collector_down', '수집기 응답 없음'],
    ] as const)('When the collection status is %s Then yellow', (collectionStatus, label) => {
      expect(status({ status: 'stale', collectionStatus, lastSuccessText: LAST })).toMatchObject({ level: 'caution', label, description: `${label} · ${LAST}` })
    })
    it('When data exists but the client refetch failed (no collector failure) Then yellow 오래된 데이터', () => {
      expect(status({ status: 'stale', collectionStatus: 'ok' })).toMatchObject({ level: 'caution', label: '오래된 데이터' })
    })
    it('When the report has unreadable items Then yellow 부분 실패', () => {
      expect(status({ status: 'ready', collectionStatus: 'ok', issueCount: 2 })).toMatchObject({ level: 'caution', label: '일부 항목을 읽지 못함' })
    })
  })

  describe('회색: 로딩·알 수 없음', () => {
    it('When loading Then gray, whatever else is passed', () => {
      expect(status({ status: 'loading', reportStatus: 'warn', collectionStatus: 'rate_limited' })).toMatchObject({ level: 'neutral', label: '불러오는 중' })
    })
    it.each([null, 'unknown'] as const)('When the report is %s Then gray 데이터 없음', (reportStatus) => {
      expect(status({ status: 'ready', reportStatus })).toMatchObject({ level: 'neutral', label: '데이터 없음' })
    })
  })

  it('When there is no last collection text Then the tooltip is the label only', () => {
    expect(status({ status: 'ready', collectionStatus: 'ok' }).description).toBe('정상')
    expect(status({ status: 'ready', collectionStatus: 'ok', lastSuccessText: LAST }).description).toBe('정상 · ' + LAST)
  })
})
