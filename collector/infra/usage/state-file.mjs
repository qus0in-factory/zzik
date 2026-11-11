/**
 * 로컬 상태 파일(ADR 0.2 D2 usage-state.json → ADR 0.3 D3 제공자별 파일).
 * 디렉터리 0700, 파일 0600, tmp에 쓰고 rename으로 원자적으로 교체한다.
 * 새 경로에 상태가 없으면 legacyPath(0.2의 usage-state.json)를 읽는다 — claude 제공자의
 * 일회성 이행으로, 백오프와 마지막 성공 본문을 잃지 않는다. 쓰기는 항상 새 경로다.
 * 누락·깨짐은 null로 돌려 app이 기본 상태를 만든다. 토큰은 이 파일에 들어가지 않는다.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** @typedef {import('../../domain/usage/ports.mjs').CollectorState} CollectorState */

/**
 * @param {{ path: string, legacyPath?: string }} options
 * @returns {{ read(): Promise<CollectorState|null>, write(state: CollectorState): Promise<void> }}
 */
export function createStateFile({ path, legacyPath }) {
  return {
    async read() {
      let readError = null
      try {
        return JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        readError = error
        // 새 상태 파일이 '없을 때만' 이전 경로로 넘어간다(v2 M6). 깨져 있으면 빈 상태로 시작한다.
        const code = /** @type {{ code?: string }} */ (readError)?.code
        if (code !== 'ENOENT') return null
      }
      if (legacyPath === undefined) return null
      try {
        return JSON.parse(await readFile(legacyPath, 'utf8'))
      } catch {
        return null
      }
    },
    async write(state) {
      const dir = dirname(path)
      await mkdir(dir, { recursive: true })
      await chmod(dir, 0o700).catch(() => {})
      const tmp = `${path}.tmp`
      await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      await rename(tmp, path)
      await chmod(path, 0o600)
    },
  }
}
