import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** 테스트용 가짜 opencode.db. 바이너리 픽스처를 커밋하지 않고 임시 디렉터리에 만든다. */
export interface FakeOpencodeDb {
  path: string
  insert(integrationId: string, value: unknown, timeUpdated: number): void
  cleanup(): void
}

export function createFakeOpencodeDb(): FakeOpencodeDb {
  const dir = mkdtempSync(join(tmpdir(), 'zzik-opencode-db-'))
  const path = join(dir, 'opencode.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE credential (integration_id TEXT NOT NULL, value TEXT NOT NULL, time_updated INTEGER NOT NULL)')
  return {
    path,
    insert(integrationId, value, timeUpdated) {
      db.prepare('INSERT INTO credential (integration_id, value, time_updated) VALUES (?, ?, ?)').run(
        integrationId,
        typeof value === 'string' ? value : JSON.stringify(value),
        timeUpdated,
      )
    },
    cleanup() {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
