/**
 * dry-run용 키 경로 목록(ADR 0.3 D6·D9). 값은 출력하지 않고 응답 구조만 확인한다.
 * 깊이 4까지 내려가고, 배열은 `[]`로 표기한 뒤 원소도 계속 훑는다.
 */

const MAX_DEPTH = 4

/** @param {unknown} value @returns {string[]} */

export function keyPaths(value) {
  /** @type {string[]} */
  const found = []
  /** @param {unknown} current @param {string} path @param {number} depth @returns {void} */
  const visit = (current, path, depth) => {
    if (depth > MAX_DEPTH) return
    if (Array.isArray(current)) {
      found.push(`${path}[]`)
      for (const item of current) visit(item, `${path}[]`, depth + 1)
      return
    }
    if (current !== null && typeof current === 'object') {
      if (depth > 0) found.push(path)
      for (const [key, child] of Object.entries(current)) {
        const childPath = depth === 0 ? key : `${path}.${key}`
        visit(child, childPath, depth + 1)
      }
      return
    }
    found.push(path) // 원시값의 경로도 구조 확인에 쓴다(값은 담지 않는다)
  }
  visit(value, '', 0)
  return [...new Set(found)]
}
