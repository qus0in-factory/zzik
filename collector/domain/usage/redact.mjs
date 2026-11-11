/**
 * 식별자 가림(ADR 0.3 D5). 제공자 정의의 가림 목록(키 경로 배열)만큼 성공 본문의 값을
 * `"[가림]"`으로 바꾸고 다시 직렬화한다. 가린 경로를 돌려준다.
 * - 목록이 비어 있으면 본문을 건드리지 않는다(재직렬화 없음, rawRedacted 없음).
 * - 가리기 전의 원문은 어디에도 저장하지 않는다.
 * import 문이 없다(전역 JSON만).
 */

const REDACTED_MARKER = '[가림]'

export { REDACTED_MARKER as CODEX_REDACTED_MARKER }

/**
 * @param {string} bodyText 성공 본문 원문(JSON 문자열)
 * @param {readonly string[]|undefined|null} redactionPaths 가림 목록(키 경로)
 * @returns {{ rawText: string, rawRedacted?: string[] }} 가림이 없으면 원문 그대로
 */
export function applyRedactions(bodyText, redactionPaths) {
  if (redactionPaths === undefined || redactionPaths === null || redactionPaths.length === 0) {
    return { rawText: bodyText }
  }
  let parsed
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return { rawText: bodyText }
  }
  if (parsed === null || typeof parsed !== 'object') return { rawText: bodyText }
  const root = /** @type {Record<string, unknown>} */ (parsed)
  /** @type {string[]} */
  const rawRedacted = []
  for (const path of redactionPaths) {
    if (setInvisibleValue(root, path.split('.'), 0)) rawRedacted.push(path)
  }
  if (rawRedacted.length === 0) return { rawText: bodyText }
  return { rawText: JSON.stringify(root), rawRedacted }
}

/** @param {Record<string, unknown>} node @param {string[]} segments @param {number} index @returns {boolean} */
function setInvisibleValue(node, segments, index) {
  const segment = segments[index]
  const current = node[segment]
  if (index === segments.length - 1) {
    if (current === undefined || current === null) return false
    node[segment] = REDACTED_MARKER
    return true
  }
  const next = current !== null && typeof current === 'object' ? current : null
  if (next === null) return false
  return setInvisibleValue(/** @type {Record<string, unknown>} */ (next), segments, index + 1)
}
