export function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}
export function isRedacted(path: string, paths: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return paths.some(redacted => normalized === normalizePath(redacted) || normalized.startsWith(normalizePath(redacted) + '.'));
}
