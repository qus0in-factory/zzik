import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 레이어 의존 규칙(ADR 0.2 D11, AGENTS.md, layered-tdd 스킬):
//   ui → app → domain, domain은 shared만, infra는 domain만 — 세 루트(src/, worker/, collector/) 공통.
//   ui가 domain을 쓸 때는 import type만 허용. infra 구현은 조립 루트에서만 생성·주입.
//   루트 사이의 import는 금지(공유는 shared/로만). 조립 루트는 배선 장소라 검사에서 제외.
//   collector는 .mjs/.cjs, 나머지는 .ts/.tsx를 검사한다.
//
// 검사는 TypeScript 파서(AST)로 한다. 문자열·주석·여러 줄 서식에 흔들리지 않고,
// 동적 import(`import('...')`)도 같은 규칙으로 잡는다. JSDoc 안의 `import('...')`는
// 주석이므로 AST에 노드가 생기지 않아 자연히 무시된다.
//
// 규칙이 실제로 동작하는지는 아래 "위반 주입" 테스트가 음성/양성 양쪽으로 확인한다.

const BASE = fileURLToPath(new URL('../..', import.meta.url))

interface RootSpec {
  name: string
  dir: string
  extensions: RegExp
}

const ROOTS: readonly RootSpec[] = [
  { name: 'src', dir: join(BASE, 'src'), extensions: /\.(ts|tsx)$/ },
  { name: 'worker', dir: join(BASE, 'worker'), extensions: /\.(ts|tsx)$/ },
  { name: 'collector', dir: join(BASE, 'collector'), extensions: /\.(mjs|cjs)$/ },
]

const SHARED_DIR = join(BASE, 'shared')
const TESTS_DIR = join(BASE, 'tests')

const LAYERS = ['ui', 'app', 'domain', 'infra'] as const
type Layer = (typeof LAYERS)[number]

const ALLOWED: Record<Layer, readonly Layer[]> = {
  ui: ['ui', 'app', 'domain'],
  app: ['app', 'domain'],
  domain: ['domain'],
  infra: ['infra', 'domain'],
}

/**
 * domain은 원칙적으로 외부 패키지를 쓰지 않는다. 예외는 순수 계산뿐인 Node 내장 모듈.
 * (수집기 domain이 봉투 지문 계산에 `node:crypto`를 쓴다. I/O 내장 모듈은 여전히 금지.)
 */
const PURE_DOMAIN_BUILTINS: readonly string[] = ['node:crypto']

export type ViolationReason =
  | 'cross-root-import'
  | 'forbidden-direction'
  | 'ui-domain-value-import'
  | 'domain-external-import'

export interface LayerViolation {
  /** BASE 기준 상대 경로 */
  file: string
  root: string
  layer: Layer
  spec: string
  reason: ViolationReason
}

export interface SourceFile {
  path: string
  text: string
}

function listSourceFiles(dir: string, extensions: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path, extensions)
    return extensions.test(entry.name) ? [path] : []
  })
}

export function loadSourceFiles(): SourceFile[] {
  return ROOTS.flatMap((root) =>
    listSourceFiles(root.dir, root.extensions).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
  )
}

export interface ImportStatement {
  kind: 'import' | 'export'
  isTypeOnly: boolean
  spec: string
}

function scriptKind(path: string): ts.ScriptKind {
  if (/\.(mjs|cjs|js)$/.test(path)) return ts.ScriptKind.JS
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/** 정적 import/export와 동적 `import('...')`을 모두 뽑는다. JSDoc 타입 참조는 AST에 없으므로 무시된다. */
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
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
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
  rootDir: string | null
}

function contextOf(path: string): FileContext {
  for (const root of ROOTS) {
    const rel = relative(root.dir, path).replace(/\\/g, '/')
    if (rel.startsWith('..')) continue
    const [first] = rel.split('/')
    return {
      root: root.name,
      layer: (LAYERS as readonly string[]).includes(first) ? (first as Layer) : null,
      rootDir: root.dir,
    }
  }
  return { root: '', layer: null, rootDir: null }
}

function layerWithin(rootDir: string, absPath: string): Layer | null {
  const rel = relative(rootDir, absPath).replace(/\\/g, '/')
  if (rel.startsWith('..')) return null
  const [first] = rel.split('/')
  return (LAYERS as readonly string[]).includes(first) ? (first as Layer) : null
}

type Target =
  | { kind: 'shared' }
  | { kind: 'tests' }
  | { kind: 'external' }
  | { kind: 'cross-root' }
  | { kind: 'layer'; root: string; layer: Layer }

/** import 스펙이 어느 루트의 어느 레이어(또는 shared·tests·외부)를 가리키는지 판정한다. */
function targetOf(fromFile: string, spec: string): Target {
  const normalized = spec.split('?')[0].split('#')[0]
  const alias = /^@(ui|app|domain|infra)\/(.*)$/.exec(normalized)
  let abs: string
  if (alias !== null) abs = join(BASE, 'src', alias[1], alias[2])
  else if (normalized.startsWith('@/')) abs = join(BASE, 'src', normalized.slice(2))
  else if (normalized.startsWith('.')) abs = resolve(dirname(fromFile), normalized)
  else return { kind: 'external' }

  if (abs === SHARED_DIR || abs.startsWith(SHARED_DIR + '/')) return { kind: 'shared' }
  if (abs === TESTS_DIR || abs.startsWith(TESTS_DIR + '/')) return { kind: 'tests' }

  for (const root of ROOTS) {
    const layer = layerWithin(root.dir, abs)
    if (layer !== null) {
      if (root.dir === contextOf(fromFile).rootDir) return { kind: 'layer', root: root.name, layer }
      return { kind: 'cross-root' }
    }
  }
  return { kind: 'cross-root' }
}

/** src/infra가 목 fixture JSON을 읽는 것은 허용한다(실행 코드가 아닌 예시 데이터). */
function isFixtureImport(layer: Layer, spec: string): boolean {
  return layer === 'infra' && spec.includes('tests/fixtures/') && spec.endsWith('.json')
}

export function findViolations(files: SourceFile[] = loadSourceFiles()): LayerViolation[] {
  const found: LayerViolation[] = []

  for (const file of files) {
    const context = contextOf(file.path)
    const { root, layer } = context
    if (layer === null) continue // 조립 루트(main.tsx, index.ts, main.mjs)는 배선 장소다

    for (const statement of importsOf(file.text, file.path)) {
      const target = targetOf(file.path, statement.spec)

      if (target.kind === 'external') {
        if (layer === 'domain' && !PURE_DOMAIN_BUILTINS.includes(statement.spec)) {
          found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'domain-external-import' })
        }
        continue
      }
      if (target.kind === 'shared') continue
      if (target.kind === 'tests') {
        if (isFixtureImport(layer, statement.spec)) continue
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'cross-root-import' })
        continue
      }
      if (target.kind === 'cross-root' || target.root !== root) {
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'cross-root-import' })
        continue
      }
      if (!ALLOWED[layer].includes(target.layer)) {
        found.push({ file: relative(BASE, file.path), root, layer, spec: statement.spec, reason: 'forbidden-direction' })
        continue
      }
      if (layer === 'ui' && target.layer === 'domain' && !statement.isTypeOnly) {
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
  it.each(ROOTS.map((root) => root.name))('When scanning %s then dependency directions and root isolation hold', (root) => {
    const violations = findViolations(loadSourceFiles().filter((file) => contextOf(file.path).root === root))
    expect(violations.map((violation) => `${violation.file}: ${violation.reason} ${violation.spec}`)).toEqual([])
  })

  it('When every root is scanned together then no root-to-root import exists', () => {
    expect(findViolations().filter((violation) => violation.reason === 'cross-root-import')).toEqual([])
  })

  it('When every root is scanned together then the aggregate list is empty', () => {
    expect(findViolations()).toEqual([])
  })

  it('When scanning then the scanner actually loaded sources (빈 스캔 방지)', () => {
    const files = loadSourceFiles()
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((file) => file.path.endsWith(join('src', 'ui', 'usage', 'LimitCard.tsx')))).toBe(true)
    expect(files.some((file) => file.path.endsWith(join('worker', 'ui', 'router.ts')))).toBe(true)
    expect(files.some((file) => file.path.endsWith(join('collector', 'app', 'usage', 'run-once.mjs')))).toBe(true)
    expect(
      files.filter((file) => contextOf(file.path).root === 'collector').every((file) => /\.(mjs|cjs)$/.test(file.path)),
    ).toBe(true)
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

  it('When domain imports app then detection fails the rule', () => {
    expect(summarize(findViolations([probe('src/domain/probe.ts', "import { loadUsage } from '@app/usage/load-usage'\n")]))).toEqual([
      ['forbidden-direction', '@app/usage/load-usage'],
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

  it('When src/ui reaches into collector then detection reports a cross-root import', () => {
    expect(summarize(findViolations([probe('src/ui/probe.tsx', "import { runOnce } from '../../collector/main.mjs'\n")]))).toEqual([
      ['cross-root-import', '../../collector/main.mjs'],
    ])
  })

  it('When collector/app imports collector/infra then detection fails the rule (mjs 포함)', () => {
    expect(summarize(findViolations([probe('collector/app/probe.mjs', "import { write } from '../infra/usage/wrangler-kv-writer.mjs'\n")]))).toEqual([
      ['forbidden-direction', '../infra/usage/wrangler-kv-writer.mjs'],
    ])
  })

  it('When collector/domain reaches into src then detection reports a cross-root import', () => {
    expect(summarize(findViolations([probe('collector/domain/probe.mjs', "import { buildUsageView } from '../../src/domain/usage/view.js'\n")]))).toEqual([
      ['cross-root-import', '../../src/domain/usage/view.js'],
    ])
  })

  it('When domain imports a node builtin with I/O then detection fails the purity rule', () => {
    expect(summarize(findViolations([probe('collector/domain/probe.mjs', "import { readFileSync } from 'node:fs'\n")]))).toEqual([
      ['domain-external-import', 'node:fs'],
    ])
  })

  it('When domain imports a pure builtin then it is allowed', () => {
    expect(findViolations([probe('collector/domain/probe.mjs', "import { createHash } from 'node:crypto'\n")])).toEqual([])
  })

  it('When a collector domain file only references shared through JSDoc then it is allowed', () => {
    const text = [
      '/**',
      ' * @typedef {import("../../../shared/usage-contract.js").UsageEnvelope} UsageEnvelope',
      ' */',
      'export function noop() {}',
      '',
    ].join('\n')
    expect(findViolations([probe('collector/domain/probe.mjs', text)])).toEqual([])
  })

  it('When a domain file imports shared directly then it is allowed', () => {
    expect(findViolations([probe('src/domain/probe.ts', "import type { UsageEnvelope } from '../../shared/usage-contract.js'\n")])).toEqual([])
  })

  it('When the infrastructure layer reads a fixture JSON then it is allowed', () => {
    expect(
      findViolations([probe('src/infra/usage/probe.ts', "import normal from '../../../tests/fixtures/claude-usage.normal.json'\n")]),
    ).toEqual([])
  })

  it('When the assembly root imports the layer implementations then it is exempt', () => {
    expect(findViolations([probe('collector/main.mjs', "import { runOnce } from './app/usage/run-once.mjs'\n")])).toEqual([])
    expect(findViolations([probe('src/main.tsx', "import App from '@ui/App'\n")])).toEqual([])
    expect(findViolations([probe('worker/index.ts', "import { createRouter } from './ui/router'\n")])).toEqual([])
  })

  it('When one clean file sits next to a violating file then only the violation is reported', () => {
    const clean = probe('src/ui/clean.tsx', "import type { UsageReport } from '@domain/usage/types'\n")
    const violating = probe('src/ui/bad.tsx', "import { BAD } from '@infra/usage/x'\n")
    expect(summarize(findViolations([clean, violating]))).toEqual([['forbidden-direction', '@infra/usage/x']])
  })
})
