import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 레이어 의존 규칙(ADR 0.2 D11, AGENTS.md):
//   ui → app → domain, domain은 shared만, infra는 domain만.
//   ui가 domain을 쓸 때는 import type만 허용. infra 구현은 조립 루트에서만 생성·주입.
// 조립 루트(src/main.tsx)는 모든 레이어를 잇는 배선 장소라 검사에서 제외한다.
//
// 검사기는 여러 줄 import(`import {\n a,\n} from '...'`)와 동적 import(`await import('...')`)를
// 모두 잡는다. 규칙이 실제로 동작하는지는 아래 "위반 주입" 테스트가 음성/양성 양쪽으로 확인한다.

type Layer = 'ui' | 'app' | 'domain' | 'infra' | 'root'

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

const LAYERS: readonly Layer[] = ['ui', 'app', 'domain', 'infra']

const FORBIDDEN: Record<Exclude<Layer, 'root'>, readonly Layer[]> = {
  domain: ['ui', 'app', 'infra'],
  app: ['ui', 'infra'],
  ui: ['infra'],
  infra: ['ui', 'app'],
}

export interface SourceFile {
  path: string
  layer: Layer
  text: string
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listSourceFiles(full, acc)
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function layerOf(absPath: string): Layer {
  const rel = relative(SRC_DIR, absPath).replace(/\\/g, '/')
  if (rel.startsWith('..')) return 'root'
  const first = rel.split('/')[0]
  return (LAYERS as readonly string[]).includes(first) ? (first as Layer) : 'root'
}

function targetLayer(fromFile: string, spec: string): Layer | null {
  const normalized = spec.split('?')[0].split('#')[0]
  if (normalized.startsWith('@ui/')) return 'ui'
  if (normalized.startsWith('@app/')) return 'app'
  if (normalized.startsWith('@domain/')) return 'domain'
  if (normalized.startsWith('@infra/')) return 'infra'
  if (normalized.startsWith('@/')) return layerOf(join(SRC_DIR, normalized.slice(2)))
  if (!normalized.startsWith('.')) return null // 외부 패키지
  const abs = resolve(dirname(fromFile), normalized)
  return layerOf(abs)
}

export function loadSourceFiles(): SourceFile[] {
  return listSourceFiles(SRC_DIR).map((path) => ({
    path,
    layer: layerOf(path),
    text: readFileSync(path, 'utf8'),
  }))
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

export interface LayerViolation {
  file: string // SRC_DIR 기준 상대 경로
  from: Layer
  spec: string
  target: Layer
  reason: 'forbidden-direction' | 'ui-domain-value-import'
}

export function findViolations(files: SourceFile[] = loadSourceFiles()): LayerViolation[] {
  const found: LayerViolation[] = []
  for (const file of files) {
    if (file.layer === 'root') continue // 조립 루트(main.tsx 등)는 배선 금지 없음
    for (const stmt of importsOf(file.text)) {
      const target = targetLayer(file.path, stmt.spec)
      if (target === null || target === 'root') continue
      const from = file.layer
      if ((FORBIDDEN as Record<Layer, readonly Layer[]>)[from].includes(target)) {
        found.push({
          file: relative(SRC_DIR, file.path),
          from,
          spec: stmt.spec,
          target,
          reason: 'forbidden-direction',
        })
      }
      if (from === 'ui' && target === 'domain' && !stmt.isTypeOnly && stmt.kind === 'import') {
        found.push({
          file: relative(SRC_DIR, file.path),
          from,
          spec: stmt.spec,
          target,
          reason: 'ui-domain-value-import',
        })
      }
    }
  }
  return found
}

function probe(text: string, layer: Layer = 'ui', name = 'probe.tsx'): SourceFile {
  return { path: join(SRC_DIR, layer, name), layer, text }
}

describe('Given the layered architecture rules', () => {
  it('When scanning src then domain never imports app, ui or infra', () => {
    const found = findViolations().filter((v) => v.from === 'domain')
    expect(found).toEqual([])
  })

  it('When scanning src then app never imports ui or infra', () => {
    const found = findViolations().filter((v) => v.from === 'app')
    expect(found).toEqual([])
  })

  it('When scanning src then ui never imports infra and takes domain only as types', () => {
    const found = findViolations().filter((v) => v.from === 'ui')
    expect(found).toEqual([])
  })

  it('When scanning src then infra imports domain only', () => {
    const found = findViolations().filter((v) => v.from === 'infra')
    expect(found).toEqual([])
  })

  it('When no violation exists then the aggregate list is empty', () => {
    expect(findViolations()).toEqual([])
  })

  it('When scanning src then the scanner actually loaded source files (빈 스캔 방지)', () => {
    const files = loadSourceFiles()
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((file) => file.path.endsWith(join('ui', 'usage', 'LimitCard.tsx')))).toBe(true)
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
      { file: 'ui/probe.tsx', from: 'ui', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When ui uses a dynamic import of infra then detection fails the rule', () => {
    const file = probe("export async function load() {\n  return import('@infra/usage/browser-runtime')\n}\n")
    expect(findViolations([file])).toEqual([
      { file: 'ui/probe.tsx', from: 'ui', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When app re-exports infra then detection fails the rule', () => {
    const file = probe("export {\n  createBrowserClock,\n} from '@infra/usage/browser-runtime'\n", 'app', 'probe.ts')
    expect(findViolations([file])).toEqual([
      { file: 'app/probe.ts', from: 'app', spec: '@infra/usage/browser-runtime', target: 'infra', reason: 'forbidden-direction' },
    ])
  })

  it('When domain imports app then detection fails the rule', () => {
    const file = probe("import { loadUsage } from '@app/usage/load-usage'\n", 'domain', 'probe.ts')
    expect(findViolations([file])).toEqual([
      { file: 'domain/probe.ts', from: 'domain', spec: '@app/usage/load-usage', target: 'app', reason: 'forbidden-direction' },
    ])
  })

  it('When ui imports a domain value then detection reports a value import', () => {
    const file = probe("import { buildUsageView } from '@domain/usage/view'\n")
    expect(findViolations([file])).toEqual([
      { file: 'ui/probe.tsx', from: 'ui', spec: '@domain/usage/view', target: 'domain', reason: 'ui-domain-value-import' },
    ])
  })

  it('When ui imports domain types only then it is allowed', () => {
    expect(findViolations([probe("import type {\n  UsageReport,\n} from '@domain/usage/types'\n")])).toEqual([])
  })

  it('When one clean file sits next to a violating file then only the violation is reported', () => {
    const clean = probe("import type { UsageReport } from '@domain/usage/types'\n", 'ui', 'clean.tsx')
    const violating = probe("import { BAD } from '@infra/usage/x'\n", 'ui', 'bad.tsx')
    expect(findViolations([clean, violating])).toEqual([
      { file: 'ui/bad.tsx', from: 'ui', spec: '@infra/usage/x', target: 'infra', reason: 'forbidden-direction' },
    ])
  })
})
