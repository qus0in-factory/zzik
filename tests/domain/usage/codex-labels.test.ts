import { describe, expect, it } from 'vitest'
import { codexWindowLabel } from '@domain/usage/codex-labels'
import { findUsageWindows, isUsageWindowObject, windowResetAt } from '@domain/usage/codex-windows'
import { USAGE_PROVIDER_REGISTRY } from '@domain/usage/providers'
import { buildUsageView } from '@domain/usage/view'

describe('Given the Codex window label rules (D6)', () => {
  it.each([
    [18000, '5시간 한도', false],
    [604800, '주간 한도', false],
  ] as const)('When the length is a known %s seconds then the fixed label applies', (seconds, label, unknown) => {
    expect(codexWindowLabel({ limit_window_seconds: seconds, used_percent: 0 }, 'rate_limit.primary_window', 'rate_limit')).toEqual({
      label, unknown,
    })
  })

  it('When the length is a known one but the path label is requested elsewhere then the top key prefixes it with 미확인', () => {
    const label = codexWindowLabel({ limit_window_seconds: 18000, used_percent: 0 }, 'codex_extra.weekly_window', 'codex_extra')
    expect(label).toEqual({ label: 'codex extra · 5시간 한도', unknown: true })
  })

  it('When the length is unknown then the label is derived from hours or days and marked unknown', () => {
    expect(codexWindowLabel({ limit_window_seconds: 3600, used_percent: 0 }, 'rate_limit.hourly', 'rate_limit')).toEqual({
      label: '1시간 한도', unknown: true,
    })
    expect(codexWindowLabel({ limit_window_seconds: 129600, used_percent: 0 }, 'rate_limit.mid', 'rate_limit')).toEqual({
      label: '1.5일 한도', unknown: true,
    })
  })

  it('When the length is missing then the id path becomes the label', () => {
    expect(codexWindowLabel({ used_percent: 0, reset_at: 1 }, 'rate_limit.mystery', 'rate_limit')).toEqual({
      label: 'rate_limit.mystery', unknown: true,
    })
  })
})

describe('Given the Codex window discovery', () => {
  it('When the object is a window then the checks match the D6 definition', () => {
    expect(isUsageWindowObject({ used_percent: 37, limit_window_seconds: 18000 })).toBe(true)
    expect(isUsageWindowObject({ used_percent: 37, reset_after_seconds: 1 })).toBe(true)
    expect(isUsageWindowObject({ used_percent: -1, limit_window_seconds: 18000 })).toBe(true) // 잘못된 값은 창이 되고 issues로 기록된다
    expect(isUsageWindowObject({ used_percent: '37', reset_at: 1 })).toBe(true)
    expect(isUsageWindowObject({ limit_window_seconds: 18000 })).toBe(false) // used_percent 없음
    expect(isUsageWindowObject({ used_percent: 37 })).toBe(false) // 리셋 필드 없음
  })

  it('When windows hide in arrays then they are found with the array path', () => {
    const found = findUsageWindows({ codes: [{ used_percent: 3, reset_after_seconds: 10 }] })
    expect(found.map((window) => window.id)).toEqual(['codes[]'])
  })

  it('When there is no reset_at but reset_after_seconds with fetchedAt then the reset is computed', () => {
    const window = { reset_after_seconds: 10 }
    expect(windowResetAt(window, '2026-11-11T12:00:00.000Z')).toBe('2026-11-11T12:00:10.000Z')
    expect(windowResetAt(window, null)).toBeNull()
    expect(windowResetAt({ reset_at: 1000 }, null)).toBe(new Date(1000 * 1000).toISOString())
  })
})

describe('Given the provider registry (D8의 등록부)', () => {
  it('When registered then Codex views come from buildCodexUsageView and Claude from buildUsageView', () => {
    const codexShapeData = {
      ok: true as const,
      usage: { five_hour: { utilization: 37 }, rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000 } } },
    }
    const successData = codexShapeData as unknown as Parameters<typeof USAGE_PROVIDER_REGISTRY.codex.buildView>[0]
    const claudeView = USAGE_PROVIDER_REGISTRY.claude.buildView(successData, { now: new Date('2026-11-11T12:00:00.000Z') })
    const codexView = USAGE_PROVIDER_REGISTRY.codex.buildView(successData, { now: new Date('2026-11-11T12:00:00.000Z'), fetchedAt: null })
    expect(claudeView.windows[0]).toMatchObject({ id: 'five_hour' })
    expect(codexView.windows[0]).toMatchObject({ id: 'rate_limit.primary_window', label: '5시간 한도' })
    void buildUsageView
  })

  it('When titles and hints are compared with D8 then they match the registry table', () => {
    expect(USAGE_PROVIDER_REGISTRY.claude).toMatchObject({
      title: 'Claude',
      extraSectionTitle: '모델·기능별 한도',
      refreshHint: '이 Mac에서 Claude Code를 실행하면 갱신된다',
    })
    expect(USAGE_PROVIDER_REGISTRY.codex).toMatchObject({
      title: 'ChatGPT (Codex)',
      extraSectionTitle: '추가 한도',
      refreshHint: '이 Mac에서 Codex를 실행하면 갱신된다',
    })
  })
})
