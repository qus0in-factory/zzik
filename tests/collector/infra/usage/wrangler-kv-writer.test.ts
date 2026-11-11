import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWranglerKvWriter } from '../../../../collector/infra/usage/wrangler-kv-writer.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zzik-kv-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const NAMESPACE_ID = '5fe6ac40c73c4d05ac2fab052c2100e6'
const KEY = 'usage:claude'
const ENVELOPE = '{"schema":1,"provider":"claude","status":"ok"}'
const NODE_BIN = '/fake/node'
const WRANGLER_BIN = '/fake/node_modules/wrangler/bin/wrangler.js'

describe('Given the wrangler KV writer adapter', () => {
  it('When writing then it runs the repo wrangler with kv key put and the namespace id', async () => {
    const execFileImpl = vi.fn(async (_file: string, args: string[], _options: unknown) => {
      // --path로 지정된 임시 파일에 봉투가 담겨 있어야 한다.
      const pathIndex = args.indexOf('--path')
      const valuePath = args[pathIndex + 1]
      expect(readFileSync(valuePath, 'utf8')).toBe(ENVELOPE)
      return { code: 0, stdout: '', stderr: '' }
    })
    const writer = createWranglerKvWriter({
      namespaceId: NAMESPACE_ID,
      keyName: KEY,
      execFileImpl,
      nodeBin: NODE_BIN,
      wranglerBin: WRANGLER_BIN,
      cwd: dir,
    })
    const result = await writer.write(ENVELOPE)
    expect(result.ok).toBe(true)
    expect(execFileImpl).toHaveBeenCalledTimes(1)
    const [file, args, options] = execFileImpl.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(file).toBe(NODE_BIN)
    expect(args).toEqual([
      WRANGLER_BIN,
      'kv', 'key', 'put', KEY,
      '--path', expect.any(String),
      '--namespace-id', NAMESPACE_ID,
      '--remote',
    ])
    expect(options.timeout).toBe(10_000)
  })

  it('When wrangler exits non-zero then the write fails with the command output', async () => {
    const execFileImpl = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'wrangler: authentication error' }))
    const writer = createWranglerKvWriter({
      namespaceId: NAMESPACE_ID, keyName: KEY, execFileImpl, nodeBin: NODE_BIN, wranglerBin: WRANGLER_BIN, cwd: dir,
    })
    const result = await writer.write(ENVELOPE)
    expect(result).toEqual({ ok: false, httpStatus: null, message: expect.stringContaining('authentication error') })
  })

  it('When wrangler gets killed or cannot start then the write fails too', async () => {
    const writer = createWranglerKvWriter({
      namespaceId: NAMESPACE_ID,
      keyName: KEY,
      execFileImpl: async () => {
        throw new Error('ENOENT')
      },
      nodeBin: NODE_BIN,
      wranglerBin: WRANGLER_BIN,
      cwd: dir,
    })
    const result = await writer.write(ENVELOPE)
    expect(result.ok).toBe(false)
  })

  it('When writing then no secret value appears in the spawned command (KV 토큰이 없다)', async () => {
    const seen: string[] = []
    const execFileImpl = vi.fn(async (file: string, args: string[]) => {
      seen.push([file, ...args].join(' '))
      return { code: 0, stdout: '', stderr: '' }
    })
    const writer = createWranglerKvWriter({
      namespaceId: NAMESPACE_ID, keyName: KEY, execFileImpl, nodeBin: NODE_BIN, wranglerBin: WRANGLER_BIN, cwd: dir,
    })
    await writer.write(ENVELOPE)
    expect(seen.join('\n')).not.toContain('Bearer')
    expect(seen.join('\n')).not.toContain('sk-ant')
  })

  it('When writing then the temp value file is removed afterwards', async () => {
    const valueFiles: string[] = []
    const execFileImpl = vi.fn(async (_file: string, args: string[]) => {
      valueFiles.push(args[args.indexOf('--path') + 1])
      return { code: 0, stdout: '', stderr: '' }
    })
    const writer = createWranglerKvWriter({
      namespaceId: NAMESPACE_ID, keyName: KEY, execFileImpl, nodeBin: NODE_BIN, wranglerBin: WRANGLER_BIN, cwd: dir,
    })
    await writer.write(ENVELOPE)
    for (const p of valueFiles) {
      expect(() => readFileSync(p)).toThrow()
    }
  })
})
