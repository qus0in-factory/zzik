/**
 * Ollama 로컬 데몬에는 토큰이 없다. run-once의 흐름(게이트·만료·호출)을 그대로 타도록
 * 항상 토큰 없는 읽기 1건을 돌려준다. 클라이언트는 token을 쓰지 않는다.
 * @returns {Promise<{ source: string, token: string, expiresAt: null, accountId: null }>}
 */
export async function readOllamaLocalCredentials() {
  return { source: 'ollama-local', token: '', expiresAt: null, accountId: null }
}
