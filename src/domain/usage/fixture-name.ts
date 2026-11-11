/** fixture 시나리오 이름의 순수 해석(스택 부록 A5: 픽스처 선택 상태의 초기값 근원). */

export type FixtureUsageName = 'normal' | 'warn' | 'limited' | 'unknown-keys' | 'auth_rejected' | 'error' | 'loading'

export const FIXTURE_USAGE_NAMES: readonly FixtureUsageName[] = [
  'normal',
  'warn',
  'limited',
  'unknown-keys',
  'auth_rejected',
  'error',
  'loading',
]

/** `?fixture=<name>`에서 이름을 해석한다. 없거나 모르는 값은 normal. */
export function parseFixtureUsageName(search: string | null | undefined): FixtureUsageName {
  const match = search ? /(?:^|[?&])fixture=([^&]*)/.exec(search) : null
  const value = match?.[1]
  if (value !== undefined && value.length > 0 && (FIXTURE_USAGE_NAMES as readonly string[]).includes(value)) {
    return value as FixtureUsageName
  }
  return 'normal'
}
