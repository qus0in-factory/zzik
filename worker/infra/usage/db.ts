import type { SnapshotDatabase } from './postgres-snapshot-store'

export interface RequestDatabase {
  db: SnapshotDatabase | null
  close(): Promise<void>
}
export type DatabaseConnector = (url: string) => RequestDatabase

/** Connection creation is injected by index.ts so this adapter never owns a driver.
 * Construction failures and absent secrets produce the same unavailable store.
 */
export function createDb(env: { DB_URL?: string }, connect: DatabaseConnector): RequestDatabase | null {
  if (!env.DB_URL?.trim()) return null
  try {
    return connect(env.DB_URL)
  } catch {
    return null
  }
}
