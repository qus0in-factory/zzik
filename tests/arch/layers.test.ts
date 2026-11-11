import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 레이어 의존 규칙(ADR 0.2 D11, AGENTS.md, layered-tdd 스킬):
//   ui → app → domain, domain은 shared만, infra는 domain만. ui가 domain을 쓸 때는 import type만.
//   src/, worker/, collector/ 세 루트는 서로 import하지 않는다(shared/만 예외).
//   조립 루트(src/main.tsx, worker/index.ts, collector/main.mjs)는 레이어 밖이라 검사에서 제외한다.
//
// 검사는 TypeScript 파서(AST)로 한다. 문자열/주석/여러 줄 서식에 흔들리지 않고,
// 동적 import(`import('...')`)도 같은 규칙으로 잡는다.

const BASE = fileURLToPath(new URL('../..', import.meta.url))

const ROOTS = ['src', 'worker', 'collector'] as const
const LAYERS = ['ui', 'app', 'domain', 'infra'] as const

type Root = (typeof ROOTS)[number]
type Layer = (typeof LAYERS)[number]

const ALLOWED: Record<Layer, readonly Layer[]> = {
  ui: ['ui', 'app', 'domain'],
  app: ['app', 'domain'],
  domain: ['domain'],
  infra: ['infra', 'domain'],
}

export type ViolationReason =
  | 'cross-root-import'
  | 'forbidden-direction'
  | 'ui-domain-value-import'
  | 'domain-external-import'

export interface LayerViolation {
  /** BASE 기준 상대 경로 */
  file: string
  root: string
  layer: Layer | null
  spec: string
  reason: ViolationReason
}

export interface SourceFile {
  path: string
  text: string
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.(tsx?|mjs)$/.test(entry.name) ? [path] : []
  })
}

export function loadSourceFiles(roots: readonly string[] = ROOTS): SourceFile[] {
  return roots.flatMap((root) => listSourceFiles(join(BASE, root)).map((path) => ({ path, text: readFileSync(path, 'utf8') })))
}

export interface ImportStatement {
  kind: 'import' | 'export'
  isTypeOnly: boolean
  spec: string
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.mjs')) return ts.ScriptKind.JS
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/** 정적 import/export와 동적 `import('...')`을 모두 문장으로 뽑는다. JSDoc 타입 참조는 AST에 없으므로 자연히 무시된다. */
export function importsOf(text: string, path = join(BASE, 'src', 'ui', 'probe.tsx')): ImportStatement[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const found: ImportStatement[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = literalText(node.moduleSpecifier)
      if (spec !== null) {
        found.push({
          kind: ts.isImportDeclaration(node) ? 'import' : 'export',
          isTypeOnly: ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly === true : node.isTypeOnly,
          spec,
        })
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const spec = literalText(node.arguments[0])
      if (spec !== null) found.push({ kind: 'import', isTypeOnly: false, spec })
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

interface FileContext {
  root: string
  layer: Layer | null
}

function contextOf(path: string): FileContext {
  const [root, layer] = relative(BASE, path).split('/')
  return { root, layer: (LAYERS as readonly string[]).includes(layer) ? (layer as Layer) : null }
}

function resolveTarget(fromFile: string, spec: string): string | null {
  const normalized = spec.split('?')[0].split('#')[0]
  const alias = /^@(ui|app|domain|infra)\/(.*)$/.exec(normalized)
  if (alias !== null) return resolve(BASE, 'src', alias[1], alias[2])
  if (normalized.startsWith('@/')) return resolve(BASE, 'src', normalized.slice(2))
  if (normalized.startsWith('.')) return resolve(dirname(fromFile), normalized)
  return null // 외부 패키지
}

/** src/infra가 목 fixture JSON을 읽는 것은 허용한다(실행 코드가 아닌 예시 데이터). */
function isFixtureImport(root: string, layer: Layer, targetRel: string, spec: string): boolean {
  return root === 'src' && layer === 'infra' && targetRel.startsWith('tests/fixtures/') && spec.endsWith('.json')
}

export function findViolations(files: SourceFile[] = loadSourceFiles()): LayerViolation[] {
  const found: LayerViolation[] = []

  for (const file of files) {
    const { root, layer } = contextOf(file.path)
    if (layer === null) continue // 조립 루트는 배선 장소다

    for (const statement of importsOf(file.text, file.path)) {
      const target = resolveTarget(file.path, statement.spec)
      if (target === null) {
        if (layer === 'domain') {
          found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'domain-external-import' })
        }
        continue
      }

      const targetRel = relative(BASE, target).replace(/\\/g, '/')
      if (targetRel.startsWith('shared/')) continue
      if (isFixtureImport(root, layer, targetRel, statement.spec)) continue

      const [targetRoot, targetLayer] = targetRel.split('/')
      if (targetRoot !== root || !(ROOTS as readonly string[]).includes(targetRoot)) {
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'cross-root-import' })
        continue
      }
      if (!(LAYERS as readonly string[]).includes(targetLayer)) continue
      if (!ALLOWED[layer].includes(targetLayer as Layer)) {
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'forbidden-direction' })
        continue
      }
      if (layer === 'ui' && targetLayer === 'domain' && !statement.isTypeOnly) {
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'ui-domain-value-import' })
      }
    }
  }

  return found
}

function probe(relPath: string, text: string): SourceFile {
  return { path: join(BASE, relPath), text }
}

function summarize(violations: LayerViolation[]): Array<[ViolationReason, string]> {
  return violations.map((violation) => [violation.reason, violation.spec])
}

describe('Given the layered source roots', () => {
  it.each(ROOTS)('When scanning %s then dependency directions and root isolation hold', (root) => {
    const violations = findViolations(loadSourceFiles([root]))
    expect(violations.map((violation) => `${violation.file}: ${violation.reason} ${violation.spec}`)).toEqual([])
  })

  it('When every root is scanned together then the aggregate list is empty', () => {
    expect(findViolations()).toEqual([])
  })

  it('When scanning then the scanner actually loaded sources (빈 스캔 방지)', () => {
    const files = loadSourceFiles()
    expect(files.length).toBeGreaterThan(15)
    expect(files.some((file) => file.path.endsWith(join('src', 'ui', 'usage', 'LimitCard.tsx')))).toBe(true)
    expect(files.some((file) => file.path.endsWith(join('worker', 'ui', 'router.ts')))).toBe(true)
    expect(files.every((file) => file.text.length > 0)).toBe(true)
  })
})

describe('Given the import scanner', () => {
  it('When an import spans several lines then its spec is found', () => {
    expect(importsOf("import {\n  Card,\n  Badge,\n} from '@infra/usage/x'\n")).toEqual([
      { kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' },
    ])
  })

  it('When an export clause spans several lines then its spec is found', () => {
    expect(importsOf("export {\n  a,\n  b,\n} from './view'\n")).toEqual([{ kind: 'export', isTypeOnly: false, spec: './view' }])
  })

  it('When a dynamic import is used then its spec is found', () => {
    expect(importsOf("const mod = await import('@infra/usage/x')\n")).toEqual([
      { kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' },
    ])
  })

  it('When a dynamic import is split over lines then its spec is found', () => {
    expect(importsOf("const mod = await import(\n  '@infra/usage/x',\n)\n")).toEqual([
      { kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' },
    ])
  })

  it('When a type-only import spans several lines then it is marked as type-only', () => {
    expect(importsOf("import type {\n  UsageReport,\n} from '@domain/usage/types'\n")).toEqual([
      { kind: 'import', isTypeOnly: true, spec: '@domain/usage/types' },
    ])
  })

  it('When import-looking text sits in a comment or a string then it is ignored', () => {
    const text = [
      "// import leaked from '@infra/usage/x'",
      "/* import leaked from '@infra/usage/y' */",
      'const text = "import leaked from \'@infra/usage/z\'"',
      "const template = `import leaked from '@infra/usage/w'`",
    ].join('\n')
    expect(importsOf(text)).toEqual([])
  })

  it('When a JSDoc type reference names a module then it is not an import', () => {
    const text = "/** @type {import('../../shared/usage-contract').UsageSnapshot} */\nconst value = {}\n"
    expect(importsOf(text, join(BASE, 'collector', 'domain', 'probe.mjs'))).toEqual([])
  })

  it('When an export has no from clause then no spec is invented', () => {
    expect(importsOf('export const value = () => 1\n')).toEqual([])
    expect(importsOf('export interface Props {\n  id: string\n}\n')).toEqual([])
  })
})

describe('Given an injected layer violation', () => {
  it('When ui imports infra over several lines then detection fails the rule', () => {
    expect(summarize(findViolations([probe('src/ui/probe.tsx', "import {\n  createBrowserClock,\n} from '@infra/usage/browser-runtime'\n")]))).toEqual([
      ['forbidden-direction', '@infra/usage/browser-runtime'],
    ])
  })

  it('When ui uses a dynamic import of infra then detection fails the rule', () => {
    expect(summarize(findViolations([probe('src/ui/probe.tsx', "export async function load() {\n  return import(\n    '@infra/usage/browser-runtime',\n  )\n}\n")]))).toEqual([
      ['forbidden-direction', '@infra/usage/browser-runtime'],
    ])
  })

  it('When app re-exports infra then detection fails the rule', () => {
    expect(summarize(findViolations([probe('src/app/probe.ts', "export {\n  createBrowserClock,\n} from '@infra/usage/browser-runtime'\n")]))).toEqual([
      ['forbidden-direction', '@infra/usage/browser-runtime'],
    ])
  })

  it('When ui imports a domain value then detection reports a value import', () => {
    expect(summarize(findViolations([probe('src/ui/probe.tsx', "import { buildUsageView } from '@domain/usage/view'\n")]))).toEqual([
      ['ui-domain-value-import', '@domain/usage/view'],
    ])
  })

  it('When ui imports domain types only then it is allowed', () => {
    expect(findViolations([probe('src/ui/probe.tsx', "import type {\n  UsageReport,\n} from '@domain/usage/types'\n")])).toEqual([])
  })

  it('When worker/domain reaches into src then detection reports a cross-root import', () => {
    expect(summarize(findViolations([probe('worker/domain/probe.ts', "import { loadUsage } from '../../../src/app/usage/load-usage'\n")]))).toEqual([
      ['cross-root-import', '../../../src/app/usage/load-usage'],
    ])
  })

  it('When worker/ui imports its own infra then detection reports a forbidden direction', () => {
    expect(summarize(findViolations([probe('worker/ui/probe.ts', "import { create } from '../infra/probe'\n")]))).toEqual([
      ['forbidden-direction', '../infra/probe'],
    ])
  })

  it('When collector/domain uses a node builtin then detection reports a domain external import', () => {
    expect(summarize(findViolations([probe('collector/domain/probe.mjs', "import { readFileSync } from 'node:fs'\n")]))).toEqual([
      ['domain-external-import', 'node:fs'],
    ])
  })

  it('When collector/domain imports collector/infra then detection fails the rule (mjs 포함)', () => {
    expect(summarize(findViolations([probe('collector/domain/probe.mjs', "import { write } from '../infra/state-file.mjs'\n")]))).toEqual([
      ['forbidden-direction', '../infra/state-file.mjs'],
    ])
  })

  it('When one clean file sits next to a violating file then only the violation is reported', () => {
    const clean = probe('src/ui/clean.tsx', "import type { UsageReport } from '@domain/usage/types'\n")
    const violating = probe('src/ui/bad.tsx', "import { BAD } from '@infra/usage/x'\n")
    expect(summarize(findViolations([clean, violating]))).toEqual([['forbidden-direction', '@infra/usage/x']])
  })
})
