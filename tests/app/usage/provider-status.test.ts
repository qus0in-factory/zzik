import { describe, expect, it } from 'vitest'
import { providerStatusOf } from '@app/usage/provider-status'

const LAST = '마지막 수집 10:09 (2분 전)'

describe('Given the provider connection light (기존 status·report.status 매핑)', () => {
  it.each([
    ['loading', null, 'neutral', '불러오는 중'],
    ['error', null, 'danger', '오류'],
    ['stale', 'normal', 'caution', '오래된 데이터'],
    ['ready', 'normal', 'ok', '정상'],
    ['ready', 'warn', 'caution', '주의'],
    ['ready', 'limit', 'danger', '한도 도달'],
    ['ready', 'unknown', 'neutral', '데이터 없음'],
    ['ready', null, 'neutral', '데이터 없음'],
  ] as const)('When status=%s and report=%s Then level %s with label %s', (status, reportStatus, level, label) => {
    expect(providerStatusOf({ status, reportStatus, lastSuccessText: null })).toMatchObject({ level, label })
  })
  it('When there is a last collection text Then the tooltip joins label and time, otherwise label only', () => {
    expect(providerStatusOf({ status: 'ready', reportStatus: 'normal', lastSuccessText: LAST }).description).toBe('정상 · ' + LAST)
    expect(providerStatusOf({ status: 'error', reportStatus: null, lastSuccessText: null }).description).toBe('오류')
  })
  it('When stale Then the last successful time is still shown (오래된 데이터 · 마지막 수집 …)', () => {
    expect(providerStatusOf({ status: 'stale', reportStatus: 'normal', lastSuccessText: LAST }).description).toBe('오래된 데이터 · ' + LAST)
  })
  it('When an error or loading state has a stale report status Then status wins over the report', () => {
    expect(providerStatusOf({ status: 'error', reportStatus: 'normal', lastSuccessText: null }).level).toBe('danger')
    expect(providerStatusOf({ status: 'loading', reportStatus: 'warn', lastSuccessText: null }).level).toBe('neutral')
  })
})
