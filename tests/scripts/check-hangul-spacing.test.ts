import { describe, expect, it } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// @ts-expect-error scripts/check-hangul-spacing.mjs is plain ESM checked by vitest
import { findLongHangulRuns } from '../../scripts/check-hangul-spacing.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/check-hangul-spacing.mjs', import.meta.url))
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

function tempMarkdown(text: string) {
  const directory = mkdtempSync(join(tmpdir(), 'zzik-spacing-'))
  const path = join(directory, 'sample.md')
  writeFileSync(path, text)
  return { directory, path }
}

describe('Given the Korean spacing checker', () => {
  it('When a line has a nine-syllable run or longer Then reports the line and run', () => {
    expect(findLongHangulRuns('짧은 문장이다.')).toEqual([])
    expect(findLongHangulRuns('가나다라마바사아')).toEqual([])
    expect(findLongHangulRuns('앞 문장\n가나다라마바사아자차 뒤')).toEqual([{ line: 2, run: '가나다라마바사아자차' }])
  })

  it('When the run is inside a fenced code block or inline code Then does not report it', () => {
    const text = [
      '본문은 정상이다.',
      '```md',
      '가나다라마바사아자차',
      '```',
      '인라인 `가나다라마바사아자차` 도 제외한다.',
      '~~~',
      '가나다라마바사아자차',
      '~~~',
    ].join('\n')
    expect(findLongHangulRuns(text)).toEqual([])
  })

  it('When a file is given Then the CLI prints file:line and exits 1', () => {
    const sample = tempMarkdown('정상 문장\n가나다라마바사아자차\n')
    try {
      const result = run([sample.path])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`${sample.path}:2:`)
      expect(result.stdout).toContain('가나다라마바사아자차')
    } finally {
      rmSync(sample.directory, { recursive: true, force: true })
    }
  })

  it('When a file is clean Then the CLI exits 0', () => {
    const sample = tempMarkdown('띄어쓰기가 정상인 문서다.\n')
    try {
      const result = run([sample.path])
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    } finally {
      rmSync(sample.directory, { recursive: true, force: true })
    }
  })

  it('When a file is missing Then the CLI exits 1 without reading it', () => {
    const result = run(['/tmp/zzik-missing-spacing-file.md'])
    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('file_not_found')
  })

  it('When every tracked Markdown file is checked Then the current repository passes', () => {
    const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).split('\n').filter((file) => file !== '')
    const result = run(files)
    expect(result.status).toBe(0)
  })

  it('When no base is given Then changedMarkdownFiles compares against origin/main', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zzik-spacing-git-'))
    const git = (...args: string[]) => execFileSync('git', ['-c', `core.hooksPath=${join(directory, 'no-hooks')}`, ...args], { cwd: directory, stdio: 'pipe' })
    try {
      git('init')
      writeFileSync(join(directory, 'deleted.md'), 'before\n')
      writeFileSync(join(directory, 'changed.md'), 'before\n')
      writeFileSync(join(directory, 'base-only.md'), 'before\n')
      git('add', '.')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base')
      writeFileSync(join(directory, 'base-only.md'), 'base branch\n')
      git('add', '.')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'base branch')
      git('update-ref', 'refs/remotes/origin/main', 'HEAD')
      git('reset', '--hard', 'HEAD^')
      rmSync(join(directory, 'deleted.md'))
      writeFileSync(join(directory, 'changed.md'), 'after\n')
      writeFileSync(join(directory, 'added.md'), 'added\n')
      writeFileSync(join(directory, 'other.txt'), 'ignored\n')
      git('add', '-A')
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'changes')

      const output = execFileSync(process.execPath, [
        '--input-type=module', '-e',
        'const { changedMarkdownFiles } = await import(process.argv[1]); console.log(JSON.stringify(changedMarkdownFiles()))',
        pathToFileURL(SCRIPT).href,
      ], { cwd: directory, encoding: 'utf8' })
      expect(JSON.parse(output)).toEqual(['added.md', 'changed.md'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('When --help is requested Then prints usage and exits 0', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('check-hangul-spacing')
  })
})
