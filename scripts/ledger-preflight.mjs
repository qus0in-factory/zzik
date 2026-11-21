#!/usr/bin/env node
/**
 * 수집기 재시작 전 점검: 운영 원장을 임시 디렉터리에 복사해 이 체크아웃(release)의 코드로 열어 본다.
 * 원본 원장은 읽기만 한다. 출력은 최종 JSON 한 줄({ok, reason?})이며 원장 내용·경로를 출력하지 않는다.
 * 0.6.60 부검: 제공자 목록이 바뀌어 새 코드가 기존 원장을 거부한 채 PM2가 재시작돼 수집이 멈췄다.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const FILES = ['collector-ledger.sqlite', 'collector-ledger.sqlite-wal', 'collector-ledger.marker.json']

/**
 * @param {{ stateDir?: string, open?: (options: { directory: string, nowMs: number }) => any, nowMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runLedgerPreflight(options = {}) {
  const stateDir = options.stateDir ?? process.env.ZZIK_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'zzik')
  if (!existsSync(join(stateDir, FILES[0]))) return { ok: true, reason: 'no_ledger' }
  const copy = mkdtempSync(join(tmpdir(), 'zzik-ledger-preflight-'))
  try {
    for (const file of FILES) if (existsSync(join(stateDir, file))) copyFileSync(join(stateDir, file), join(copy, file))
    const open = options.open ?? (await import('../collector/infra/usage/sqlite-ledger.mjs')).openSqliteLedger
    const opened = open({ directory: copy, nowMs: options.nowMs ?? Date.now() })
    if (!opened?.ok) return { ok: false, reason: typeof opened?.reason === 'string' ? opened.reason : 'ledger_open_failed' }
    opened.value.close()
    return { ok: true }
  } catch {
    return { ok: false, reason: 'preflight_failed' }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runLedgerPreflight()
  process.stdout.write(JSON.stringify(result) + '\n')
  process.exitCode = result.ok ? 0 : 1
}
