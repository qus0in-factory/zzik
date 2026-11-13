import type { SnapshotDatabase } from './postgres-snapshot-store'

export interface RequestDatabase {
  db: SnapshotDatabase | null
  close(): Promise<void>
}
export interface WorkerDatabaseOptions {
  max: 1
  prepare: false
  connect_timeout: 5
  channel_binding: 'prefer'
}
export type DatabaseConnector = (url: string, options: WorkerDatabaseOptions) => RequestDatabase

/** Connection creation is injected by index.ts so this adapter never owns a driver.
 * Construction failures and absent secrets produce the same unavailable store.
 */
export function createDb(env: { DB_URL?: string }, connect: DatabaseConnector): RequestDatabase | null {
  if (!env.DB_URL?.trim()) return null
  try {
    // Workers sockets cannot expose the peer certificate used by SCRAM-PLUS.
    // Keep TLS from the URL; allow verified TLS + SCRAM without forcing PLUS.
    // Bound connection setup below the browser's ten-second request timeout.
    return connect(env.DB_URL, { max: 1, prepare: false, connect_timeout: 5, channel_binding: 'prefer' })
  } catch {
    return null
  }
}
