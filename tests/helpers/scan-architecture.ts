import ts from 'typescript';
import { dirname, resolve, extname } from 'node:path';
interface Source {
  path: string;
  text: string;
}
function imports(file: Source) {
  const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true), result: {
    spec: string | null;
    type: boolean;
  }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const spec = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        const type = ts.isExportDeclaration(node) ? node.isTypeOnly : node.importClause?.isTypeOnly === true || (node.importClause?.name === undefined && node.importClause?.namedBindings !== undefined && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.length > 0 && node.importClause.namedBindings.elements.every(e => e.isTypeOnly));
        result.push({ spec, type });
      }
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      result.push({ spec: a && ts.isStringLiteral(a) ? a.text : null, type: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
function target(path: string, spec: string): string { const p = resolve(dirname(path), spec); return extname(p) ? p : p + '.ts'; }
export function findScanViolations(files: Source[], dir: string): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const item of imports(file)) {
      const p = item.spec?.startsWith('.') ? target(file.path, item.spec) : null;
      if (p !== null && p.startsWith(dir + '/') && item.spec!.endsWith('.ts'))
        continue;
      if (p === resolve(dir, '../usage-contract.ts') && item.type)
        continue;
      violations.push(file.path + ': import ' + item.spec);
    }
    const source = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Date' && (node.arguments?.length ?? 0) === 0)
        violations.push(file.path + ': clock');
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText(source).replace(/\[['"](\w+)['"]\]/g, '.$1');
        if (/^(?:(?:globalThis|window)\.)?(?:Date(?:\.now)?|Math\.random|fetch|console\.\w+)(?:\.(?:call|apply))?$/.test(text))
          violations.push(file.path + ': ' + text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}
export function scanClosure(files: Source[], entry: string): string[] {
  const map = new Map(files.map(f => [f.path, f])), seen = new Set<string>();
  const walk = (path: string) => { if (seen.has(path))
    return; seen.add(path); const file = map.get(path); if (file)
    for (const edge of imports(file))
      if (edge.spec?.startsWith('.'))
        walk(target(path, edge.spec)); };
  walk(entry);
  return [...seen];
}
