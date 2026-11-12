/**
 * `agy -p /quota` 출력(탭 구분: 그룹 · 창 라벨 · 잔여% · UTC ISO 시각)에서 Argon 주간 버킷을
 * 만들어 요약 API 본문에 합성한다. API는 Argon 그룹을 돌려주지 않기 때문이다(조사 보고서 2.3).
 * 순수 함수만 둔다(프로세스 실행은 infra).
 */

export const ARGON_GROUP_NAME = 'Gemini 4 Argon'

/**
 * @param {unknown} text
 * @returns {Array<{ group: string, label: string, remainingFraction: number, resetTime: string }>}
 */
export function parseAgyQuotaTsv(text) {
  if (typeof text !== 'string') return []
  const rows = []
  for (const line of text.split('\n')) {
    const cells = line.split('\t').map((cell) => cell.trim())
    if (cells.length < 4) continue
    const [group, label, percentText, resetTime] = cells
    const match = /^(\d+(?:\.\d+)?)%$/.exec(percentText)
    if (group === '' || label === '' || match === null) continue
    const percent = Number(match[1])
    if (percent > 100 || !Number.isFinite(Date.parse(resetTime))) continue
    rows.push({ group, label, remainingFraction: percent / 100, resetTime })
  }
  return rows
}

/**
 * @param {unknown} text
 * @returns {{ bucketId: string, displayName: string, window: string, resetTime: string, remainingFraction: number }|null}
 */
export function argonBucketFromQuota(text) {
  const row = parseAgyQuotaTsv(text).find((item) => item.group === ARGON_GROUP_NAME)
  if (row === undefined) return null
  return {
    bucketId: 'argon-weekly',
    displayName: 'Weekly Limit Remaining',
    window: 'weekly',
    resetTime: row.resetTime,
    remainingFraction: row.remainingFraction,
  }
}

/**
 * API 본문에 Argon 그룹이 없을 때만 합성 그룹을 덧붙인다. 형상이 다르면 본문을 그대로 돌려준다.
 * @param {string} bodyText
 * @param {object} bucket argonBucketFromQuota의 결과
 * @returns {string}
 */
export function mergeArgonIntoSummary(bodyText, bucket) {
  let parsed
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return bodyText
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.groups)) return bodyText
  const hasArgon = parsed.groups.some((/** @type {any} */ group) => group !== null && typeof group === 'object' && group.displayName === ARGON_GROUP_NAME)
  if (hasArgon) return bodyText
  return JSON.stringify({ ...parsed, groups: [...parsed.groups, { displayName: ARGON_GROUP_NAME, buckets: [bucket] }] })
}
