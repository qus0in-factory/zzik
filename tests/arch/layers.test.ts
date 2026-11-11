import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 레이어 의존 규칙(ADR 0.2 D11, AGENTS.md):
//   ui → app → domain, domain은 shared만, infra는 domain만.
//   ui가 domain을 쓸 때는 import type만 허용. infra 구현은 조립 루트에서만 생성·주입.
// 조립 루트(src/main.tsx)는 모든 레이어를 잇는 배선 장소라 검사에서 제외한다.

type Layer = 'ui' | 'app' | 'domain' | 'infra' | 'root'

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

const LAYERS: readonly Layer[] = ['ui', 'app', 'domain', 'infra']

const FORBIDDEN: Record<Exclude<Layer, 'root'>, readonly Layer[]> = {
  domain: ['ui', 'app', 'infra'],
  app: ['ui', 'infra'],
  ui: ['infra'],
  infra: ['ui', 'app'],
}

interface SourceFile {
  path: string
  layer: Exclude<Layer, 'root'> | 'root'
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

function loadSourceFiles(): SourceFile[] {
  return listSourceFiles(SRC_DIR).map((path) => ({
    path,
    layer: layerOf(path) as SourceFile['layer'],
    text: readFileSync(path, 'utf8'),
  }))
}

interface ImportStatement {
  kind: 'import' | 'export'
  isTypeOnly: boolean
  spec: string
}

const FROM_PATTERN = /(?:^|\n)\s*(import|export)\s+([^;\n]*?)from\s*['"]([^'"]+)['"]/g
const BARE_PATTERN = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function importsOf(text: string): ImportStatement[] {
  const found: ImportStatement[] = []
  for (const [, kind, clause, spec] of text.matchAll(FROM_PATTERN)) {
    found.push({ kind, isTypeOnly: /^\s*type\b/.test(clause), spec: spec.trim() })
  }
  for (const [, spec] of text.matchAll(BARE_PATTERN)) {
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

function findViolations(): LayerViolation[] {
  const found: LayerViolation[] = []
  for (const file of loadSourceFiles()) {
    if (file.layer === 'root') continue // 조립 루트(main.tsx 등)는 배선 금지 없음
    for (const stmt of importsOf(file.text)) {
      const target = targetLayer(file.path, stmt.spec)
      if (target === null || target === 'root') continue
      const from = file.layer
      if (from === 'root') continue
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
})
