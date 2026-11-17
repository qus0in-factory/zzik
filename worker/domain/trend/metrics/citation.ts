/**
 * AA brief citation의 단일 진입 검증. 생성 단계와 공개 projection이 같은 규칙을 쓴다.
 * 프리폼 문자열을 신뢰하지 않고 검증된 모델 표시명·숫자 값으로 고정 틀을 다시 만든다.
 */

const MAX_NAME_LENGTH = 80
const MAX_CITATION_LENGTH = 500
const CITATION_RE = /^Artificial Analysis Intelligence Index 1위는 (.+) \((\d+(?:\.\d+)?)\)입니다\. \((\d{4}-\d{2}-\d{2}) 기준\)$/

/** 모델 표시명: 버전 점은 허용, 개행·추가 문장·직렬화 괄호는 거부. */
export function safeModelName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) return null
  if (/[\r\n\u0000-\u001f\u007f]/.test(name)) return null
  if (/[\[\]{}()"'\\]/.test(name)) return null
  if (/[.!?]\s/.test(name) || /[.!?]$/.test(name)) return null
  if (/입니다|기준|Artificial Analysis/.test(name)) return null
  return name
}

function scoreText(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) return value
  return null
}

/** 검증된 값으로만 한 문장을 만든다. 하나라도 의심스러우면 null(공개에서 제외). */
export function composeAaCitation(input: { name: unknown; score: unknown; day: string }): string | null {
  const name = safeModelName(input.name)
  const score = scoreText(input.score)
  if (name === null || score === null || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return null
  const text = `Artificial Analysis Intelligence Index 1위는 ${name} (${score})입니다. (${input.day} 기준)`
  return text.length <= MAX_CITATION_LENGTH ? text : null
}

/** 저장된 레거시 문자열을 같은 틀로 재검사해, 통과하면 정규 문장만 돌려준다. */
export function validatedAaCitation(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > MAX_CITATION_LENGTH) return null
  const matched = CITATION_RE.exec(text)
  if (matched === null) return null
  const canonical = composeAaCitation({ name: matched[1], score: matched[2], day: matched[3]! })
  return canonical === text ? canonical : null
}
