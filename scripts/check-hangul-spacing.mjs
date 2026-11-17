#!/usr/bin/env node
/**
 * Deterministic Korean spacing check (issue #106 item 8).
 * Reports runs of 9+ Hangul syllables outside fenced code blocks and inline code.
 * With no file arguments, checks Markdown files changed by dev...HEAD.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const DEFAULT_THRESHOLD = 9

/** @param {string} text @param {number} [threshold] @returns {{line:number,run:string}[]} */
export function findLongHangulRuns(text, threshold = DEFAULT_THRESHOLD) {
  const min = Number.isSafeInteger(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD
  const pattern = new RegExp(`[가-힣]{${min},}`, 'g')
  /** @type {{line:number,run:string}[]} */
  const findings = []
  const lines = text.split(/\r?\n/)
  let fence = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (marker !== null) {
      const character = marker[1][0]
      if (fence === null) fence = character
      else if (fence === character) fence = null
      continue
    }
    if (fence !== null) continue
    const withoutInlineCode = line.replace(/`+[^`]*`+/g, '')
    for (const match of withoutInlineCode.matchAll(pattern)) findings.push({ line: index + 1, run: match[0] })
  }
  return findings
}

/** @param {readonly string[]} files @returns {number} */
export function checkFiles(files) {
  let failed = false
  for (const file of files) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      process.stderr.write(`${file}: file_not_found\n`)
      failed = true
      continue
    }
    for (const finding of findLongHangulRuns(text)) {
      process.stdout.write(`${file}:${finding.line}: ${finding.run}\n`)
      failed = true
    }
  }
  return failed ? 1 : 0
}

/** @param {string} [base] @returns {string[]} */
export function changedMarkdownFiles(base = 'dev') {
  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], { encoding: 'utf8' })
  return String(output)
    .split(/\r?\n/)
    .filter((file) => file !== '' && file.endsWith('.md'))
}

function usage() {
  process.stdout.write(
    'node scripts/check-hangul-spacing.mjs [--help] [--base <ref>] [file ...]\n' +
      'Reports 9+ consecutive Hangul syllable runs outside fenced code blocks and inline code.\n' +
      'Without file arguments, checks .md files from `git diff --name-only <base>...HEAD` (default base: dev).\n' +
      'Exits 1 when any finding or missing file exists.\n',
  )
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    usage()
    return
  }
  const baseAt = args.indexOf('--base')
  const base = baseAt >= 0 ? args[baseAt + 1] : 'dev'
  if (!base) {
    process.stderr.write('missing_base\n')
    process.exitCode = 64
    return
  }
  let files = baseAt >= 0 ? args.filter((_, i) => i !== baseAt && i !== baseAt + 1) : args
  if (files.length === 0) {
    try {
      files = changedMarkdownFiles(base)
    } catch {
      process.stderr.write('git_diff_failed\n')
      process.exitCode = 1
      return
    }
  }
  process.exitCode = checkFiles(files)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch {
    process.stderr.write('hangul_spacing_check_failed\n')
    process.exitCode = 1
  }
}
