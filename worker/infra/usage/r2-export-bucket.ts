/**
 * ADR 0.10 §6.1/§6.2 private R2 object store.
 * The R2 binding is injected only into the export/restore function, never the fetch router.
 */
import type { ExportObjectReader, ExportSink } from '../../domain/usage/export'

export interface R2ObjectBodyLike {
  text(): Promise<string>
}

export interface R2ObjectLike {
  key: string
  size?: number
}

export interface R2ListResultLike {
  objects: R2ObjectLike[]
  truncated: boolean
  cursor?: string
}

export interface R2BucketLike {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
  list(options?: { prefix?: string; cursor?: string }): Promise<R2ListResultLike>
}

export class R2ExportObjectStore implements ExportSink, ExportObjectReader {
  constructor(private readonly bucket: R2BucketLike) {}

  async putObject(key: string, body: string): Promise<number> {
    const bytes = new TextEncoder().encode(body).length
    await this.bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } })
    return bytes
  }

  async list(prefix = ''): Promise<string[]> {
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) })
      keys.push(...page.objects.map(object => object.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return keys.sort()
  }

  async read(key: string): Promise<string | null> {
    const object = await this.bucket.get(key)
    return object === null ? null : object.text()
  }
}
