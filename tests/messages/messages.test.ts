import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ko, t } from '@shared/messages'
import type { MessageKey } from '@shared/messages'

const BASE = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

const SRC_FILES = sourceFiles(join(BASE, 'src'))
const KO_PATH = join(BASE, 'shared/messages/ko.ts')
const KEYS = Object.keys(ko) as MessageKey[]
const texts = new Map(SRC_FILES.map((path) => [path, readFileSync(path, 'utf8')]))

/**
 * 한글 문자열 리터럴이 남아도 되는 파일(허용 목록). 사용자에게 보이는 문구가 아니라
 * 개발자용 오류·목 데이터라서 메시지 리소스로 옮기지 않는다.
 */
const HARDCODED_ALLOWLIST: Record<string, string> = {
  'src/app/usage/UsageGatewayContext.tsx': '조립 루트가 의존을 주입하지 않았을 때 던지는 개발자용 오류',
  'src/app/usage/history/chart-view.ts': '동결된 ui↔app 계약 타입(ADR 0.7 T0)의 라벨 리터럴 유니온 — 값은 이력 문구 모듈이 t()로 옮길 때까지 타입에만 남는다',
  'src/infra/usage/fixture-usage-gateway.ts': 'DEV 전용 목 게이트웨이의 시나리오 오류 메시지',
}

/** 주석을 제외하고 한글이 들어간 문자열 리터럴·템플릿·JSX 텍스트를 찾는다(TypeScript 파서 기준). */
function hardcodedKorean(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    if (literal && /[가-힣]/.test(node.getText(source))) found.push(node.getText(source).trim().slice(0, 40))
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('Given the t() accessor', () => {
  it('When a message has no placeholders Then it takes no params and returns the text', () => {
    expect(t('action.retry')).toBe('다시 시도')
  })
  it('When a message has placeholders Then they are filled (numbers included)', () => {
    expect(t('card.elapsed', { percent: 56 })).toBe('기간 경과 56%')
    expect(t('chips.grabbed', { provider: 'Claude', position: 1, total: 6 })).toContain('Claude 칩을 잡았습니다. 현재 1번째, 전체 6개.')
  })
  it('Then missing keys or params are type errors (checked by tsc, documented here)', () => {
    // @ts-expect-error 존재하지 않는 키
    expect(t('no.such.key')).toBe('no.such.key')
    // @ts-expect-error 필수 매개변수 누락
    expect(t('card.elapsed')).toBe('기간 경과 {percent}%')
  })
})

describe('Given the message resource', () => {
  it('Then every key is used by the source (no dead messages)', () => {
    const code = SRC_FILES.filter((path) => path !== KO_PATH).map((path) => texts.get(path) ?? '').join('\n')
    const unused = KEYS.filter((key) => !code.includes(`'${key}'`))
    expect(unused).toEqual([])
  })
  it('Then every literal t(...) key in the source exists in the resource', () => {
    const missing: string[] = []
    for (const [path, text] of texts) {
      for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) if (!(match[1] in ko)) missing.push(`${relative(BASE, path)}: ${match[1]}`)
    }
    expect(missing).toEqual([])
  })
  it('Then keys are unique, dotted, and values are non-empty', () => {
    expect(new Set(KEYS).size).toBe(KEYS.length)
    for (const key of KEYS) {
      expect(key).toMatch(/^[a-zA-Z]+(\.[a-zA-Z_]+)+$/)
      expect(ko[key].length).toBeGreaterThan(0)
    }
  })
})

describe('Given the source files (하드코딩 문구 잔여 검사)', () => {
  it('When scanning string literals, templates and JSX text Then no Korean text is left outside the message resource', () => {
    const violations = [...texts]
      .filter(([path]) => path !== KO_PATH && !(relative(BASE, path) in HARDCODED_ALLOWLIST))
      .flatMap(([path, text]) => hardcodedKorean(path, text).map((snippet) => `${relative(BASE, path)}: ${snippet}`))
    expect(violations).toEqual([])
  })
  it('Then the allowlist only names files that still contain Korean (no stale entries)', () => {
    for (const file of Object.keys(HARDCODED_ALLOWLIST)) expect(hardcodedKorean(file, readFileSync(join(BASE, file), 'utf8')).length).toBeGreaterThan(0)
  })
  it('Then the scanner itself catches a hardcoded literal (negative control)', () => {
    expect(hardcodedKorean('probe.tsx', "const a = <p>안녕</p>; const b = '문구'; // 주석은 무시")).toEqual(['안녕', "'문구'"])
  })
})
