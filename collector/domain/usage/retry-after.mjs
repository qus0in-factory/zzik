/**
 * Retry-After 헤더 해석(ADR 0.2 D5). 초 표기와 HTTP-date 표기를 모두 읽고
 * [300, 86400]초 범위로 자른다. 해석할 수 없거나 0, 음수, 과거 시각이면 없는 것으로 본다.
 */

const MIN_SEC = 300
const MAX_SEC = 86_400

/**
 * @param {string|null|undefined} rawValue Retry-After 헤더 원문
 * @param {number} nowMs 해석 기준 시각(밀리초). 과거 시각 판정에 쓴다
 * @returns {number|null} 허용 대기(초), 해석 불가면 null
 */
export function parseRetryAfter(rawValue, nowMs) {
  if (rawValue === null || rawValue === undefined || typeof rawValue !== 'string') return null
  const raw = rawValue.trim()
  if (raw === '') return null

  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw)
    if (!(seconds > 0)) return null
    return Math.min(Math.max(seconds, MIN_SEC), MAX_SEC)
  }

  const target = Date.parse(raw)
  if (Number.isNaN(target)) return null
  if (target <= nowMs) return null
  const seconds = Math.ceil((target - nowMs) / 1000)
  return Math.min(Math.max(seconds, MIN_SEC), MAX_SEC)
}
