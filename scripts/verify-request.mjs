#!/usr/bin/env node
/**
 * Build a Discord confirmation-request body (issue #100).
 * Prints the body to stdout and does not send it. Pipe into scripts/notify-discord.sh.
 */
import { pathToFileURL } from 'node:url'

const VERSION = /^\d+\.\d+(?:\.\d+)?$/

/**
 * @param {{version?:string,summary?:string,checks?:readonly string[]}} input
 * @returns {{ok:true,body:string}|{ok:false,reason:'invalid_version'|'summary_required'|'checks_required'}}
 */
export function verifyRequestBody(input) {
  const version = input.version ?? ''
  const summary = (input.summary ?? '').trim()
  const checks = (input.checks ?? []).map((check) => check.trim()).filter((check) => check !== '')
  if (!VERSION.test(version)) return { ok: false, reason: 'invalid_version' }
  if (summary === '') return { ok: false, reason: 'summary_required' }
  if (checks.length === 0 || checks.length !== (input.checks ?? []).length) return { ok: false, reason: 'checks_required' }
  const body = [
    `버전: ${version}`,
    '',
    '바뀐 것',
    summary,
    '',
    '검증',
    ...checks.map((check) => `- ${check}`),
    '',
    '확인 부탁',
    '인증된 브라우저에서 운영 화면을 확인해 주세요. 이 메시지는 완료 보고가 아닙니다.',
    '',
    '다음',
    '확인 결과를 받기 전에는 배포 완료로 보고하지 않습니다.',
    '',
  ].join('\n')
  return { ok: true, body }
}

function usage() {
  process.stderr.write(
    'node scripts/verify-request.mjs --version <version> --summary <text> --check <item> [--check <item>...]\n' +
      'Writes the confirmation body to stdout. It does not send Discord. Pipe stdout to scripts/notify-discord.sh.\n',
  )
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  let version = ''
  let summary = ''
  /** @type {string[]} */
  const checks = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--version' && args[i + 1] && !args[i + 1].startsWith('--')) version = args[++i]
    else if (arg === '--summary' && args[i + 1] && !args[i + 1].startsWith('--')) summary = args[++i]
    else if (arg === '--check' && args[i + 1] && !args[i + 1].startsWith('--')) checks.push(args[++i])
    else {
      process.stderr.write('invalid_arguments\n')
      process.exitCode = 64
      return
    }
  }
  const built = verifyRequestBody({ version, summary, checks })
  if (!built.ok) {
    process.stderr.write(`${built.reason}\n`)
    process.exitCode = 64
    return
  }
  process.stdout.write(built.body)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch {
    process.stderr.write('verify_request_failed\n')
    process.exitCode = 1
  }
}
