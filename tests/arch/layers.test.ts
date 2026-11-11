import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 레이어 의존 규칙(ADR 0.2 D11, AGENTS.md):
//   ui → app → domain, domain은 shared만, infra는 domain만 — 세 루트(src/, worker/, collector/) 공통.
//   ui가 domain을 쓸 때는 import type만 허용. infra 구현은 조립 루트에서만 생성·주입.
//   루트 사이의 import는 금지(공유는 shared/로만). 조립 루트는 모든 레이어를 잇는 배선 장소라 제외.
//   .mjs도 검사하고, JSDoc 안의 import('…') 타입 참조는 주석이므로 검사하지 않는다.
//
// 검사기는 여러 줄 import(`import {\n a,\n} from '...'`)와 동적 import(`await import('...')`)를
// 모두 잡는다. 규칙이 실제로 동작하는지는 아래 "위반 주입" 테스트가 음성/양성 양쪽으로 확인한다.

type Layer = 'ui' | 'app' | 'domain' | 'infra' | 'root'
type RootName = 'src' | 'collector'

const ROOTS: readonly { name: RootName; dir: string; extensions: RegExp }[] = [
  { name: 'src', dir: fileURLToPath(new URL('../../src', import.meta.url)), extensions: /\.(ts|tsx)$/ },
  { name: 'collector', dir: fileURLToPath(new URL('../../collector', import.meta.url)), extensions: /\.(mjs)$/ },
]
const SHARED_DIR = fileURLToPath(new URL('../../shared', import.meta.url))
const TESTS_DIR = fileURLToPath(new URL('../../tests', import.meta.url))

const LAYERS: readonly Layer[] = ['ui', 'app', 'domain', 'infra']

const FORBIDDEN: Record<Exclude<Layer, 'root'>, readonly Layer[]> = {
  domain: ['ui', 'app', 'infra'],
  app: ['ui', 'infra'],
  ui: ['infra'],
  infra: ['ui', 'app'],
}

export interface SourceFile {
  root: RootName
  path: string
  layer: Layer
  text: string
}

function listSourceFiles(dir: string, extensions: RegExp, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, extensions, acc)
    else if (extensions.test(entry.name)) acc.push(full)
  }
  return acc
}

function layerWithin(rootDir: string, absPath: string): Layer | null {
  const rel = relative(rootDir, absPath).replace(/\\/g, '/')
  if (rel.startsWith('..')) return null
  const first = rel.split('/')[0]
  return (LAYERS as readonly string[]).includes(first) ? (first as Layer) : 'root'
}

interface TargetSpec {
  root: RootName | 'shared' | 'cross-root'
  layer: Layer | null
}

/** import 스펙이 어느 루트의 어느 레이어(또는 shared·루트 밖)를 가리키는지 판정한다. */
function targetSpec(fromFile: SourceFile, spec: string): TargetSpec | null {
  const normalized = spec.split('?')[0].split('#')[0]
  if (normalized.startsWith('@ui/')) return { root: 'src', layer: 'ui' }
  if (normalized.startsWith('@app/')) return { root: 'src', layer: 'app' }
  if (normalized.startsWith('@domain/')) return { root: 'src', layer: 'domain' }
  if (normalized.startsWith('@infra/')) return { root: 'src', layer: 'infra' }
  if (normalized.startsWith('@/')) {
    const abs = join(ROOTS[0].dir, normalized.slice(2))
    if (abs.startsWith(SHARED_DIR)) return { root: 'shared', layer: null }
    return { root: 'src', layer: layerWithin(ROOTS[0].dir, abs) }
  }
  if (!normalized.startsWith('.')) return null // 외부 패키지(node builtins 포함)

  const abs = resolve(dirname(fromFile.path), normalized)
  if (abs.startsWith(SHARED_DIR)) return { root: 'shared', layer: null }
  // tests/ 픽스처는 예외로 허용한다(0.2.1의 fixture 게이트웨이·계약이 tests/fixtures를 읽는다).
  if (abs.startsWith(TESTS_DIR)) return { root: 'shared', layer: null }
  const own = ROOTS.find((root) => root.name === fromFile.root)
  const inOwn = layerWithin(own?.dir ?? '', abs)
  if (inOwn !== null) return { root: fromFile.root, layer: inOwn }
  for (const root of ROOTS) {
    if (root.name === fromFile.root) continue
    if (layerWithin(root.dir, abs) !== null) return { root: 'cross-root', layer: null }
  }
  // 두 루트 밖(tests/, node_modules 상대 경로 등)은 전부 루크 간 경계 위반으로 본다.
  return { root: 'cross-root', layer: null }
}

export function loadSourceFiles(): SourceFile[] {
  const found: SourceFile[] = []
  for (const root of ROOTS) {
    for (const path of listSourceFiles(root.dir, root.extensions)) {
      found.push({ root: root.name, path, layer: layerWithin(root.dir, path), text: readFileSync(path, 'utf8') })
    }
  }
  return found
}

export interface ImportStatement {
  kind: 'import' | 'export'
  isTypeOnly: boolean
  spec: string
}

/** 주석을 지우되 문자열 안의 `//`, `/*`는 보존하고 줄바꿈 수를 유지한다. */
export function stripComments(source: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (quote !== null) {
      if (char === '\\') {
        out += char + (next ?? '')
        index += 2
        continue
      }
      if (char === quote) quote = null
      out += char
      index += 1
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') out += '\n'
        index += 1
      }
      index += 2
      continue
    }

    out += char
    index += 1
  }

  return out
}

function braceDelta(text: string): number {
  let depth = 0
  for (const char of text) {
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
  }
  return depth
}

const HAS_FROM = /from\s*['"]([^'"]+)['"]/
const BARE_IMPORT = /^import\s*['"]([^'"]+)['"]/
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"][\s,]*\)/g

/**
 * 정적 import/export를 문장 단위로 훑는다. 여러 줄에 걸친 절(clause)은
 * 중괄호가 닫힐 때까지 이어 붙인다. 동적 import는 별도 정규식으로 잡는다.
 */
export function importsOf(source: string): ImportStatement[] {
  const text = stripComments(source)
  const lines = text.split('\n')
  const found: ImportStatement[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    const start = /^(import|export)\b/.exec(trimmed)
    if (start === null) continue

    let statement = trimmed
    let cursor = index
    while (cursor + 1 < lines.length && HAS_FROM.exec(statement) === null && braceDelta(statement) > 0) {
      cursor += 1
      statement += '\n' + lines[cursor]
    }
    index = cursor

    const bare = BARE_IMPORT.exec(statement)
    if (bare !== null) {
      found.push({ kind: 'import', isTypeOnly: false, spec: bare[1].trim() })
      continue
    }

    const from = HAS_FROM.exec(statement)
    if (from === null) continue
    found.push({
      kind: start[1] as 'import' | 'export',
      isTypeOnly: /^(?:import|export)\s+type\b/.test(statement),
      spec: from[1].trim(),
    })
  }

  for (const [, spec] of text.matchAll(DYNAMIC_IMPORT)) {
    found.push({ kind: 'import', isTypeOnly: false, spec: spec.trim() })
  }

  return found
}

export type ViolationReason = 'forbidden-direction' | 'ui-domain-value-import' | 'cross-root-import'

export interface LayerViolation {
  root: RootName
  file: string // 소속 루트 기준 상대 경로
  from: Layer
  spec: string
  target: string // 레이어 또는 'shared'/'cross-root'
  reason: ViolationReason
}

export function findViolations(files: SourceFile[] = loadSourceFiles()): LayerViolation[] {
  const found: LayerViolation[] = []
  for (const file of files) {
    if (file.layer === 'root') continue // 조립 루트(main.tsx, main.mjs)는 배선 금지 없음
    for (const stmt of importsOf(file.text)) {
      const target = targetSpec(file, stmt.spec)
      if (target === null) continue
      if (target.root === 'shared') continue // 공유 계약은 모든 레이어가 쓴다
      if (target.root === 'cross-root' || target.layer === null || target.layer === 'root') {
        found.push({
          root: file.root,
          file: relativeToRoot(file),
          from: file.layer,
          spec: stmt.spec,
          target: target.root === 'cross-root' ? 'cross-root' : (target.layer ?? 'root'),
          reason: 'cross-root-import',
        })
        continue
      }
      if ((FORBIDDEN as Record<Layer, readonly Layer[]>)[file.layer].includes(target.layer)) {
        found.push({
          root: file.root,
          file: relativeToRoot(file),
          from: file.layer,
          spec: stmt.spec,
          target: target.layer,
          reason: 'forbidden-direction',
        })
      }
      if (file.layer === 'ui' && target.layer === 'domain' && !stmt.isTypeOnly && stmt.kind === 'import') {
        found.push({
          root: file.root,
          file: relativeToRoot(file),
          from: file.layer,
          spec: stmt.spec,
          target: target.layer,
          reason: 'ui-domain-value-import',
        })
      }
    }
  }
  return found
}

function relativeToRoot(file: SourceFile): string {
  const ownRoot = ROOTS.find((root) => root.name === file.root)
  return relative(ownRoot?.dir ?? '', file.path)
}

function probe(
  text: string,
  layer: Layer = 'ui',
  name = 'probe.tsx',
  root: RootName = 'src',
): SourceFile {
  const rootDir = ROOTS.find((entry) => entry.name === root)?.dir ?? ''
  return { root, path: join(rootDir, layer, name), layer, text }
}

describe('Given the layered architecture rules', () => {
  it('When scanning src then domain never imports app, ui or infra', () => {
    const found = findViolations().filter((v) => v.root === 'src' && v.from === 'domain')
    expect(found).toEqual([])
  })

  it('When scanning src then app never imports ui or infra', () => {
    const found = findViolations().filter((v) => v.root === 'src' && v.from === 'app')
    expect(found).toEqual([])
  })

  it('When scanning src then ui never imports infra and takes domain only as types', () => {
    const found = findViolations().filter((v) => v.root === 'src' && v.from === 'ui')
    expect(found).toEqual([])
  })

  it('When scanning src then infra imports domain only', () => {
    const found = findViolations().filter((v) => v.root === 'src' && v.from === 'infra')
    expect(found).toEqual([])
  })

  it('When scanning collector then domain never imports app, ui or infra', () => {
    const found = findViolations().filter((v) => v.root === 'collector' && v.from === 'domain')
    expect(found).toEqual([])
  })

  it('When scanning collector then app never imports ui or infra', () => {
    const found = findViolations().filter((v) => v.root === 'collector' && v.from === 'app')
    expect(found).toEqual([])
  })

  it('When scanning collector then infra imports domain only', () => {
    const found = findViolations().filter((v) => v.root === 'collector' && v.from === 'infra')
    expect(found).toEqual([])
  })

  it('When scanning both roots then no root-to-root import exists', () => {
    const found = findViolations().filter((v) => v.reason === 'cross-root-import')
    expect(found).toEqual([])
  })

  it('When no violation exists then the aggregate list is empty', () => {
    expect(findViolations()).toEqual([])
  })

  it('When scanning both roots then the scanner actually loaded source files (빈 스캔 방지)', () => {
    const files = loadSourceFiles()
    expect(files.length).toBeGreaterThan(20)
    expect(files.some((file) => file.path.endsWith(join('ui', 'usage', 'LimitCard.tsx')))).toBe(true)
    expect(files.some((file) => file.path.endsWith(join('app', 'usage', 'run-once.mjs')))).toBe(true)
    expect(files.some((file) => file.root === 'collector' && !file.path.endsWith('.mjs'))).toBe(false)
    expect(files.every((file) => file.text.length > 0)).toBe(true)
  })
})

describe('Given the import scanner', () => {
  it('When an import spans several lines then its spec is found', () => {
    const specs = importsOf("import {\n  Card,\n  Badge,\n} from '@infra/usage/x'\n")
    expect(specs).toEqual([{ kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' }])
  })

  it('When an export clause spans several lines then its spec is found', () => {
    const specs = importsOf("export {\n  a,\n  b,\n} from './view'\n")
    expect(specs).toEqual([{ kind: 'export', isTypeOnly: false, spec: './view' }])
  })

  it('When a dynamic import is used then its spec is found', () => {
    const specs = importsOf("const mod = await import('@infra/usage/x')\n")
    expect(specs).toEqual([{ kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' }])
  })

  it('When a dynamic import is split over lines then its spec is found', () => {
    const specs = importsOf("const mod = await import(\n  '@infra/usage/x',\n)\n")
    expect(specs).toEqual([{ kind: 'import', isTypeOnly: false, spec: '@infra/usage/x' }])
  })

  it('When a type-only import spans several lines then it is marked as type-only', () => {
    const specs = importsOf("import type {\n  UsageReport,\n} from '@domain/usage/types'\n")
    expect(specs).toEqual([{ kind: 'import', isTypeOnly: true, spec: '@domain/usage/types' }])
  })

  it('When import-looking text is inside a comment or a string then it is ignored', () => {
    const specs = importsOf(
      [
        "// import leaked from '@infra/usage/x'",
        "/* import leaked from '@infra/usage/y' */",
        'const text = "import leaked from \'@infra/usage/z\'"',
        "const template = `import leaked from '@infra/usage/w'`",
      ].join('\n'),
    )
    expect(specs).toEqual([])
  })

  it('When an export does not have a from clause then no spec is invented', () => {
    expect(importsOf('export const value = () => 1\n')).toEqual([])
    expect(importsOf('export interface Props {\n  id: string\n}\n')).toEqual([])
  })
})

describe('Given an injected layer violation', () => {
  it('When ui imports infra over several lines then detection fails the rule', () => {
    const file = probe("import {\n  createBrowserClock,\n} from '@infra/usage/browser-runtime'\n")
    expect(findViolations([file])).toEqual([
      { root: 'src', file: 'ui/probe.tsx', from: 'ui', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When ui uses a dynamic import of infra then detection fails the rule', () => {
    const file = probe("export async function load() {\n  return import('@infra/usage/browser-runtime')\n}\n")
    expect(findViolations([file])).toEqual([
      { root: 'src', file: 'ui/probe.tsx', from: 'ui', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When app re-exports infra then detection fails the rule', () => {
    const file = probe("export {\n  createBrowserClock,\n} from '@infra/usage/browser-runtime'\n", 'app', 'probe.ts')
    expect(findViolations([file])).toEqual([
      { root: 'src', file: 'app/probe.ts', from: 'app', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When domain imports app then detection fails the rule', () => {
    const file = probe("import { loadUsage } from '@app/usage/load-usage'\n", 'domain', 'probe.ts')
    expect(findViolations([file])).toEqual([
      { root: 'src', file: 'domain/probe.ts', from: 'domain', spec: '@app/usage/load-usage', target: 'app', reason: 'forbidden-direction' },
    ])
  })

  it('When ui imports a domain value then detection reports a value import', () => {
    const file = probe("import { buildUsageView } from '@domain/usage/view'\n")
    expect(findViolations([file])).toEqual([
      { root: 'src', file: 'ui/probe.tsx', from: 'ui', spec: '@domain/usage/view', target: 'domain', reason: 'ui-domain-value-import' },
    ])
  })

  it('When ui imports domain types only then it is allowed', () => {
    expect(findViolations([probe("import type {\n  UsageReport,\n} from '@domain/usage/types'\n")])).toEqual([])
  })

  it('When one clean file sits next to a violating file then only the violation is reported', () => {
    const clean = probe("import type { UsageReport } from '@domain/usage/types'\n", 'ui', 'clean.tsx')
    const violating = probe("import { BAD } from '@infra/usage/x'\n", 'ui', 'bad.tsx')
    expect(findViolations([clean, violating])).toEqual([
      { root: 'src', file: 'ui/bad.tsx', from: 'ui', spec: '@infra/usage/x', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When collector app imports infra then detection fails the rule', () => {
    const file = probe(
      "import { createWranglerKvWriter } from '../infra/usage/wrangler-kv-writer.mjs'\n",
      'app',
      'probe.mjs',
      'collector',
    )
    expect(findViolations([file])).toEqual([
      {
        root: 'collector',
        file: join('app', 'probe.mjs'),
        from: 'app',
        spec: '../infra/usage/wrangler-kv-writer.mjs',
        target: 'infra',
        reason: 'forbidden-direction',
      },
    ])
  })

  it('When a collector file reaches into src then detection reports a cross-root import', () => {
    const file = probe(
      "import { buildUsageView } from '../../src/domain/usage/view.js'\n",
      'domain',
      'probe.mjs',
      'collector',
    )
    expect(findViolations([file])).toEqual([
      {
        root: 'collector',
        file: join('domain', 'probe.mjs'),
        from: 'domain',
        spec: '../../src/domain/usage/view.js',
        target: 'cross-root',
        reason: 'cross-root-import',
      },
    ])
  })

  it('When a src file reaches into collector then detection reports a cross-root import', () => {
    const file = probe("import { runOnce } from '../../collector/main.mjs'\n", 'ui', 'probe.tsx')
    expect(findViolations([file])).toEqual([
      {
        root: 'src',
        file: 'ui/probe.tsx',
        from: 'ui',
        spec: '../../collector/main.mjs',
        target: 'cross-root',
        reason: 'cross-root-import',
      },
    ])
  })

  it('When a collector domain file only references shared through JSDoc then it is allowed', () => {
    const file = probe(
      [
        '/**',
        ' * @typedef {import("../../../shared/usage-contract.js").UsageEnvelope} UsageEnvelope',
        ' */',
        'export function noop() {}',
        '',
      ].join('\n'),
      'domain',
      'probe.mjs',
      'collector',
    )
    expect(findViolations([file])).toEqual([])
  })

  it('When a src domain file imports shared directly then it is allowed', () => {
    const file = probe("import type { UsageEnvelope } from '../../shared/usage-contract.js'\n", 'domain', 'probe.ts')
    expect(findViolations([file])).toEqual([])
  })

  it('When the assembly root imports the layer implementations then it is exempt', () => {
    const collectorMain = {
      root: 'collector' as const,
      path: join(ROOTS[1].dir, 'main.mjs'),
      layer: 'root' as const,
      text: "import { runOnce } from './app/usage/run-once.mjs'\n",
    }
    expect(findViolations([collectorMain])).toEqual([])
  })
})
