/**
 * AA 주목 모델 인용의 단일 진입 검증. 생성 단계와 공개 projection이 같은 규칙을 쓴다.
 * 순위·점수·지수 이름은 공개 문장에 넣지 않고, 모델 대표 이름만 알파벳 순으로 나열한다.
 */

const MAX_NAME_LENGTH = 80
const MAX_MODELS = 7
const MAX_CITATION_LENGTH = 700
const PREFIX = '요즘 주목받는 모델은 '
const SUFFIX = ' 등입니다.'
const CITATION_RE = /^요즘 주목받는 모델은 (.+) 등입니다\.$/
const RANK_WORD_RE = /\d+\s*위|순위|지수|점수|rank|score|index/i
const VERSION_TOKEN_RE = /^\d+(?:\.\d+)*$/

/** 모델 표시명: 버전 점과 "(high)" 같은 괄호 수식은 허용, 개행·추가 문장·직렬화 기호는 거부. */
export function safeModelName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) return null
  if (/[\r\n\u0000-\u001f\u007f]/.test(name)) return null
  if (/[\[\]{}"'\\]/.test(name)) return null
  if (/[.!?]\s/.test(name) || /[.!?]$/.test(name)) return null
  if (/입니다|기준|Artificial Analysis/.test(name)) return null
  return name
}

function extractFamilyKey(name: string): string | null {
  if (safeModelName(name) !== name || /[()]/.test(name) || RANK_WORD_RE.test(name)) return null
  const tokens = name.split(' ')
  if (tokens.some((token) => token === '')) return null
  for (const token of tokens) {
    if (/\d/.test(token) && !VERSION_TOKEN_RE.test(token)) return null
  }
  const key = tokens
    .filter((token) => !VERSION_TOKEN_RE.test(token))
    .join(' ')
    .toLowerCase()
  return key === '' ? null : key
}

/** 원시 표시명에서 괄호 수식을 제거하고 버전은 남긴 계열 대표 이름으로 만든다. */
export function notableFamilyName(raw: string): string | null {
  const withoutModifier = raw.replace(/\([^)]*\)/g, ' ').replace(/\s*-\s*/g, ' ')
  const name = safeModelName(withoutModifier.replace(/\s+/g, ' ').trim())
  if (name === null || extractFamilyKey(name) === null) return null
  return name
}

/** 원시 표시명에서 괄호 수식과 버전 숫자를 모두 제거한 계열 식별 키(소문자)를 돌려준다. */
export function notableFamilyKey(raw: string): string | null {
  const name = notableFamilyName(raw)
  return name === null ? null : extractFamilyKey(name)
}

/** 검증된 대표 이름 목록으로 한 문장을 만든다. 하나라도 의심스러우면 null. */
export function composeNotableCitation(names: readonly string[]): string | null {
  if (!Array.isArray(names) || names.length === 0 || names.length > MAX_MODELS) return null
  const clean: string[] = []
  const seenFamilies = new Set<string>()
  for (const name of names) {
    const familyKey = extractFamilyKey(name)
    if (familyKey === null || seenFamilies.has(familyKey)) return null
    seenFamilies.add(familyKey)
    clean.push(name)
  }
  for (let index = 1; index < clean.length; index += 1) {
    if (clean[index - 1]!.localeCompare(clean[index]!) >= 0) return null
  }
  const text = PREFIX + clean.join(', ') + SUFFIX
  return text.length <= MAX_CITATION_LENGTH ? text : null
}

/** UI가 이름만 강조할 수 있도록 같은 규칙으로 문장을 파싱한다. 실패하면 null. */
export function parseNotableCitation(text: unknown): { prefix: string; names: string[]; suffix: string } | null {
  if (typeof text !== 'string' || text.length > MAX_CITATION_LENGTH) return null
  const matched = CITATION_RE.exec(text)
  if (matched === null) return null
  const names = matched[1]!.split(', ')
  if (composeNotableCitation(names) !== text) return null
  return { prefix: PREFIX, names, suffix: SUFFIX }
}

/** 저장된 레거시 문자열을 같은 틀로 재검사해, 통과하면 정규 문장만 돌려준다. */
export function validatedAaCitation(text: unknown): string | null {
  return parseNotableCitation(text) === null ? null : text as string
}
