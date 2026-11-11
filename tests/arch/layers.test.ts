import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const base = fileURLToPath(new URL('../..', import.meta.url))
const roots = ['src', 'worker', 'collector']
const layers = ['ui', 'app', 'domain', 'infra']
const allowed: Record<string, string[]> = { ui: ['ui', 'app', 'domain'], app: ['app', 'domain'], domain: ['domain'], infra: ['infra', 'domain'] }
function files(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : /\.(tsx?|mjs)$/.test(path) ? [path] : []
  })
}
function violations(path: string, text: string): string[] {
  const [root, layer] = relative(base, path).split('/')
  if (!layers.includes(layer)) return [] // composition roots wire adapters
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const errors: string[] = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const specNode = statement.moduleSpecifier
    if (!specNode || !ts.isStringLiteral(specNode)) continue
    const spec = specNode.text
    const alias = /^@(ui|app|domain|infra)\/(.*)$/.exec(spec)
    const target = spec.startsWith('.') ? resolve(dirname(path), spec)
      : alias ? resolve(base, 'src', alias[1], alias[2])
      : spec.startsWith('@/') ? resolve(base, 'src', spec.slice(2)) : null
    if (!target) {
      if (layer === 'domain') errors.push(`domain external import: ${spec}`)
      continue
    }
    const [targetRoot, targetLayer] = relative(base, target).split('/')
    if (targetRoot === 'shared') continue
    // Existing development fixture adapter imports JSON examples, never executable test code.
    if (root === 'src' && layer === 'infra' && targetRoot === 'tests' && relative(base, target).startsWith('tests/fixtures/') && target.endsWith('.json')) continue
    if (targetRoot !== root || !roots.includes(targetRoot)) { errors.push(`cross-root import: ${spec}`); continue }
    if (!allowed[layer].includes(targetLayer)) errors.push(`forbidden direction: ${layer} → ${targetLayer}`)
    const typeOnly = ts.isImportDeclaration(statement) ? statement.importClause?.isTypeOnly : statement.isTypeOnly
    if (layer === 'ui' && targetLayer === 'domain' && !typeOnly) errors.push(`ui domain value import: ${spec}`)
  }
  return errors
}
describe('Given layered source roots', () => {
  it.each(roots)('When scanning %s Then dependency directions and root isolation hold', (root) => {
    expect(files(join(base, root)).flatMap((path) => violations(path, readFileSync(path, 'utf8')).map((error) => `${relative(base, path)}: ${error}`))).toEqual([])
  })
  it('When a forbidden Worker import is introduced Then the checker detects it', () => {
    expect(violations(join(base, 'worker/domain/probe.ts'), "import { x } from '../../src/app/x'\n")).not.toEqual([])
    expect(violations(join(base, 'worker/domain/probe.ts'), "import { x } from '../infra/x'\n")).not.toEqual([])
    expect(violations(join(base, 'collector/domain/probe.mjs'), "import x from 'node:fs'\n")).not.toEqual([])
  })
  it('When collector JSDoc references shared types Then it is ignored as a type comment', () => {
    expect(violations(join(base, 'collector/domain/probe.mjs'), "/** @type {import('../../shared/usage-contract').UsageSnapshot} */\nconst value = {}\n")).toEqual([])
  })
})
