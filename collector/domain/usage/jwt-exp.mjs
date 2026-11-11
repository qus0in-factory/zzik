/**
 * JWT에서 만료(exp)만 읽는다(ADR 0.3 D2). base64url payload을 풀어 exp(초)를 ms로 바꾼다.
 * 서명은 검증하지 않는다
 * @param {string|undefined|null} token access token 원문
 * @returns {number|null} exp의 밀리초, 판정 불가면 null — 이 값은 "호출해 봐야 소용없는지" 미리 아는 용도일 뿐이고
 * 인증 판단은 서버가 한다. 만료를 알 수 없으면 null로 두고 호출해서 401로 판정한다.
 */

export function parseJwtExpiredAt(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const payload = parts[1]
  if (payload.length === 0) return null
  let json
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    if (parsed === null || typeof parsed !== 'object') return null
    const exp = parsed['exp']
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
    return exp * 1000
  } catch {
    return null
  }
}
