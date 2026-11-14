/**
 * `agy -p /quota` 출력(탭 구분: 그룹 · 창 라벨 · 잔여% · UTC ISO 시각)을 해석한다.
 * 0.6부터 Antigravity 수집은 API 대신 이 CLI 출력 하나를 쓴다(ADR 0.4 0.6 변경 절).
 * 순수 함수만 둔다(프로세스 실행은 infra).
 */

export const AGY_QUOTA_RAW_SOURCE = 'agy-quota-cli'
export const AGY_QUOTA_RAW_SCHEMA = 1

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
 * 저장할 원문(JSON). CLI 표의 그룹·라벨·잔여%·리셋 시각만 남기고 계정 식별자는 넣지 않는다.
 * 의미 해석(창 id·주기·사용률)은 Worker의 antigravity 파서가 한다.
 * @param {unknown} text
 * @returns {string|null} 유효한 행이 하나도 없으면 null
 */
export function buildQuotaRawText(text) {
  const rows = parseAgyQuotaTsv(text)
  if (rows.length === 0) return null
  return JSON.stringify({
    source: AGY_QUOTA_RAW_SOURCE,
    schema: AGY_QUOTA_RAW_SCHEMA,
    rows: rows.map((row) => ({
      group: row.group,
      label: row.label,
      remainingPercent: Math.round(row.remainingFraction * 100 * 10000) / 10000,
      resetsAt: row.resetTime,
    })),
  })
}
