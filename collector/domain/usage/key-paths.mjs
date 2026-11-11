/**
 * dry-run용 키 경로 목록(ADR 0.3 v2 D6). 값은 출력하지 않고 응답 구조만 확인한다.
 * 깊이 6까지 내려가고, 배열은 `[]`로 표기한 뒤 원소도 계속 훑는다.
 * 깊이 한도에서 컨테이너를 만나면 경로 끝에 `…`를 붙여 더 깊은 키가 있음을 알린다.
 */

const MAX_DEPTH = 6

/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function keyPaths(value) {
  const found = new Set()
  /**
   * @param {unknown} current
   * @param {string} path
   * @param {number} depth
   * @returns {void}
   */
  const visit = (current, path, depth) => {
    const isContainer = current !== null && typeof current === 'object'
    if (!isContainer) {
      if (depth > 0 || path === '') found.add(path)
      return
    }
    if (depth >= MAX_DEPTH) {
      // 절단 지점: 노드 경로와, 더 깊은 키가 있음을 뜻하는 '…' 표기를 함께 남긴다(v2 D6).
      if (path !== '') found.add(path)
      found.add(path === '' ? (Array.isArray(current) ? '[]…' : '…') : `${path}…`)
      return
    }
    if (Array.isArray(current)) {
      const arrayPath = path === '' ? '[]' : `${path}[]`
      found.add(arrayPath)
      for (const item of current) visit(item, arrayPath, depth + 1)
      return
    }
    if (path !== '') found.add(path)
    for (const [key, child] of Object.entries(current)) {
      visit(child, path === '' ? key : `${path}.${key}`, depth + 1)
    }
  }
  visit(value, '', 0)
  return [...found]
}
