/**
 * KV 쓰기 어댑터(운영 제약 개정: Cloudflare REST API 토큰 대신 레포의 wrangler를 실행한다).
 *
 *   node <node_modules/wrangler/bin/wrangler.js> kv key put <key> --path <tmp> --namespace-id <id> --remote
 *
 * 이 Mac에 로그인된 wrangler OAuth 세션을 infra로 쓴다. 토큰 파일·set-token.sh는 없다.
 * 봉투는 임시 파일(0600)로 넘기고 실행 뒤 지운다. 타임아웃 10초(D2).
 */

import { execFile as execFileCallback } from 'node:child_process'
import { unlink, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** @typedef {import('../../domain/usage/ports.mjs').KvWriteResult} KvWriteResult */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DEFAULT_WRANGLER_BIN = join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * execFile을 { code, stdout, stderr }로 통일한다. 실패도 예외 대신 결과로 돌려준다.
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd: string, timeout: number }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
const defaultExecFile = (file, args, options) =>
  new Promise((resolve) => {
    execFileCallback(file, args, options, (error, stdout, stderr) => {
      if (error === null || error === undefined) {
        resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        return
      }
      let code = 1
      if (typeof error.code === 'string' && /^\d+$/.test(error.code)) code = Number(error.code)
      else if (typeof error.code === 'number') code = error.code
      else if (error.killed) code = 124
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })

/** @param {string} text @returns {string} */
function shortTail(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return ''
  const last = trimmed.split('\n').slice(-2).join(' ').trim()
  return last.length > 300 ? `${last.slice(0, 300)}…` : last
}

/**
 * @param {{
 *   namespaceId: string,
 *   keyName: string,
 *   execFileImpl?: (file: string, args: string[], options: { cwd: string, timeout: number }) => Promise<{ code: number, stdout: string, stderr: string }>,
 *   nodeBin?: string,
 *   wranglerBin?: string,
 *   cwd?: string,
 *   timeoutMs?: number,
 * }} deps
 * @returns {{ write(value: string): Promise<KvWriteResult> }}
 */
export function createWranglerKvWriter({
  namespaceId,
  keyName,
  execFileImpl = defaultExecFile,
  nodeBin = process.execPath,
  wranglerBin = DEFAULT_WRANGLER_BIN,
  cwd = REPO_ROOT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  return {
    async write(value) {
      const tempDir = mkdtempSync(join(tmpdir(), 'zzik-kv-put-'))
      const valuePath = join(tempDir, 'value.json')
      try {
        await writeFile(valuePath, value, { mode: 0o600 })
        const args = [
          wranglerBin,
          'kv',
          'key',
          'put',
          keyName,
          '--path',
          valuePath,
          '--namespace-id',
          namespaceId,
          '--remote',
        ]
        const { code, stdout, stderr } = await execFileImpl(nodeBin, args, { timeout: timeoutMs, cwd })
        if (code === 0) return { ok: true }
        const detail = shortTail(stderr) || shortTail(stdout) || `exit ${code}`
        return { ok: false, httpStatus: null, message: `wrangler exit ${code}: ${detail}` }
      } catch (error) {
        return { ok: false, httpStatus: null, message: `갑작스러운 오류: ${String(error)}` }
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    },
  }
}
