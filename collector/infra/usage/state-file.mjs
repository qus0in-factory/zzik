/**
 * 로컬 상태 파일(ADR 0.2 D2 usage-state.json).
 * 디렉터리 0700, 파일 0600, tmp에 쓰고 rename으로 원자적으로 교체한다.
 * 누락·깨짐은 null로 돌려 app이 기본 상태를 만든다. 토큰은 이 파일에 들어가지 않는다.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** @typedef {import('../../domain/usage/ports.mjs').CollectorState} CollectorState */

/**
 * @param {{ path: string }} options
 * @returns {{ read(): Promise<CollectorState|null>, write(state: CollectorState): Promise<void> }}
 */
export function createStateFile({ path }) {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(path, 'utf8'))
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
